import type { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import path from "path";
import { promises as fs } from "fs";
import type { LocalFsStorage } from "../infrastructure/storage";
import type { OcrClient, OcrScanRawResponse, NormalizedReceipt } from "../infrastructure/ocr-client";
import { normalizeReceiptOcr } from "../infrastructure/ocr-client";
import { preprocessForOcr } from "../infrastructure/image-preprocessor";

export interface UploadReceiptInput {
  userId: string;
  fileBuf: Buffer;
  fileName: string;
  mimeType: string;
}

export interface UpdateReceiptInput {
  extractedAmount?: number | null | undefined;
  extractedMerchant?: string | null | undefined;
  extractedDate?: Date | null | undefined;
}

export interface SplitRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class ReceiptService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: LocalFsStorage,
    private readonly ocr: OcrClient,
    private readonly suggestMatchesForReceipt: (receiptId: string) => Promise<number>,
  ) {}

  async list(userId: string, params: { page?: number; limit?: number; ocrStatus?: string } = {}) {
    const { page = 1, limit = 50, ocrStatus } = params;
    const where: any = { userId };
    if (ocrStatus) where.ocrStatus = ocrStatus;

    const [items, total] = await Promise.all([
      this.prisma.expenseReceipt.findMany({
        where,
        include: { matches: { take: 5 } },
        orderBy: { uploadedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expenseReceipt.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async get(userId: string, id: string) {
    const r = await this.prisma.expenseReceipt.findFirst({
      where: { id, userId },
      include: {
        matches: {
          include: {
            transaction: {
              include: { source: true, category: true },
            },
          },
        },
      },
    });
    if (!r) throw new Error("영수증을 찾을 수 없습니다.");
    return r;
  }

  async upload(input: UploadReceiptInput) {
    const { storageKey } = await this.storage.save(input.fileBuf, input.fileName);

    const receipt = await this.prisma.expenseReceipt.create({
      data: {
        userId: input.userId,
        fileUrl: storageKey, // storageKey 자체를 fileUrl로도 사용 (다운로드 시 storage.read())
        storageKey,
        originalFileName: input.fileName,
        fileType: input.mimeType,
        fileSize: input.fileBuf.length,
        ocrStatus: "PENDING",
      },
    });

    // fire-and-forget OCR 파이프라인
    setImmediate(() => {
      this.runOcrPipeline(receipt.id, input.fileBuf, input.fileName).catch((err) => {
        // 콘솔만 — DB는 runOcrPipeline 내부에서 FAILED 마킹
        console.error(`[ocr-pipeline] ${receipt.id} failed:`, err.message);
      });
    });

    return receipt;
  }

  async delete(userId: string, id: string) {
    const receipt = await this.get(userId, id);
    await this.prisma.expenseReceipt.delete({ where: { id } });
    await this.storage.remove(receipt.storageKey);
  }

  // OCR 결과 수동 수정 (가맹점/금액/거래일).
  // OCR 실패였는데 사용자가 값을 채우면 자동 DONE 처리 + 매칭 후보 재생성.
  async update(userId: string, id: string, data: UpdateReceiptInput) {
    const r = await this.prisma.expenseReceipt.findFirst({ where: { id, userId } });
    if (!r) throw new Error("영수증을 찾을 수 없습니다.");

    const updateData: any = {};
    if (data.extractedAmount !== undefined) updateData.extractedAmount = data.extractedAmount;
    if (data.extractedMerchant !== undefined) updateData.extractedMerchant = data.extractedMerchant;
    if (data.extractedDate !== undefined) updateData.extractedDate = data.extractedDate;

    // OCR 실패였는데 사용자가 값을 채우면 자동 DONE
    const hasMeaningfulValue =
      (data.extractedAmount !== undefined && data.extractedAmount !== null) ||
      (data.extractedMerchant !== undefined && data.extractedMerchant !== null && data.extractedMerchant !== "") ||
      (data.extractedDate !== undefined && data.extractedDate !== null);
    if (r.ocrStatus === "FAILED" && hasMeaningfulValue) {
      updateData.ocrStatus = "DONE";
    }

    const updated = await this.prisma.expenseReceipt.update({
      where: { id: r.id },
      data: updateData,
    });

    // 매칭 후보 재생성 (값 변경 시)
    if (updated.ocrStatus === "DONE" && updated.extractedAmount && updated.extractedDate) {
      try {
        await this.suggestMatchesForReceipt(updated.id);
      } catch (err: any) {
        console.error(`[match-suggest] ${updated.id}:`, err.message);
      }
    }

    return updated;
  }

  // 사용자가 그린 사각형 영역대로 영수증 수동 분할.
  // 원본을 N개로 crop → 새 ExpenseReceipt N개 생성 + 각각 OCR. 원본은 삭제.
  async splitByRegions(userId: string, id: string, regions: SplitRegion[]) {
    const original = await this.prisma.expenseReceipt.findFirst({
      where: { id, userId },
    });
    if (!original) throw new Error("영수증을 찾을 수 없습니다.");
    if (!original.fileType.startsWith("image/")) {
      throw new Error("이미지 파일만 분할 가능합니다 (PDF는 외부 도구 필요).");
    }
    if (regions.length === 0) throw new Error("최소 1개 영역이 필요합니다.");

    const originalDiskPath = this.storage.resolveDiskPath(original.storageKey);
    const meta = await sharp(originalDiskPath).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (W === 0 || H === 0) throw new Error("이미지 크기를 읽을 수 없습니다.");

    const ext = path.extname(original.originalFileName) || ".jpg";
    const baseName = path.parse(original.originalFileName).name;
    const created: { id: string; ocrStatus: string }[] = [];

    for (let i = 0; i < regions.length; i++) {
      const r = regions[i]!;
      const left = Math.max(0, Math.floor(r.x * W));
      const top = Math.max(0, Math.floor(r.y * H));
      const width = Math.min(W - left, Math.ceil(r.width * W));
      const height = Math.min(H - top, Math.ceil(r.height * H));
      if (width < 10 || height < 10) continue; // 너무 작은 영역 skip

      const croppedBuf = await sharp(originalDiskPath).extract({ left, top, width, height }).toBuffer();
      const newName = `${baseName}__${i + 1}${ext}`;
      const { storageKey: newKey } = await this.storage.save(croppedBuf, newName);

      const newReceipt = await this.prisma.expenseReceipt.create({
        data: {
          userId,
          fileUrl: newKey,
          storageKey: newKey,
          originalFileName: newName,
          fileType: original.fileType,
          fileSize: croppedBuf.length,
          ocrStatus: "PENDING",
        },
      });
      created.push({ id: newReceipt.id, ocrStatus: newReceipt.ocrStatus });

      // fire-and-forget OCR
      setImmediate(() => {
        this.runOcrPipeline(newReceipt.id, croppedBuf, newName).catch((err) => {
          console.error(`[ocr-pipeline] split ${newReceipt.id} failed:`, err.message);
        });
      });
    }

    // 원본 삭제 (DB + 파일)
    await this.prisma.expenseReceipt.delete({ where: { id: original.id } });
    await this.storage.remove(original.storageKey);

    return created;
  }

  // 재OCR — 기존 파일을 다시 OCR 처리.
  async reprocess(userId: string, id: string) {
    const r = await this.prisma.expenseReceipt.findFirst({ where: { id, userId } });
    if (!r) throw new Error("영수증을 찾을 수 없습니다.");

    const diskPath = this.storage.resolveDiskPath(r.storageKey);
    const buf = await fs.readFile(diskPath);

    await this.prisma.expenseReceipt.update({
      where: { id: r.id },
      data: {
        ocrStatus: "PENDING",
        extractedAmount: null,
        extractedMerchant: null,
        extractedDate: null,
        ocrText: null,
        ocrEngineUsed: null,
        ocrCompletedAt: null,
      },
    });

    setImmediate(() => {
      this.runOcrPipeline(r.id, buf, r.originalFileName).catch((err) => {
        console.error(`[ocr-pipeline] reprocess ${r.id} failed:`, err.message);
      });
    });

    return { status: "PENDING" as const };
  }

  // OCR 파이프라인:
  //   1. 전처리 (sharp: auto-rotate + greyscale + normalise + sharpen) — 이미지만
  //   2. clova-ocr 시도 (전처리된 이미지)
  //   3. 결과 빈약(texts<3 또는 amount=null)하면 claude-vision으로 fallback (원본 컬러)
  //   4. 더 좋은 결과 채택 → DB 저장 → 매칭 후보 자동 제안
  async runOcrPipeline(receiptId: string, originalBuffer: Buffer, fileName: string) {
    await this.prisma.expenseReceipt.update({
      where: { id: receiptId },
      data: { ocrStatus: "RUNNING" },
    });

    try {
      // Step 1: 전처리 (PDF/sharp 미지원 형식은 원본 사용)
      let preBuffer = originalBuffer;
      let preInfo: string | null = null;
      try {
        const result = await preprocessForOcr(originalBuffer);
        preBuffer = result.buffer;
        preInfo = result.applied.join(",");
      } catch (e: any) {
        console.log(`[ocr-pipeline] ${receiptId} preprocess skipped: ${e.message}`);
      }

      // Step 2: clova-ocr 시도 (전처리된 이미지) — claude-vision fallback 제거 (ERP 전체에서 미사용)
      const raw: OcrScanRawResponse = await this.ocr.scanRaw(preBuffer, fileName, "clova-ocr");
      const norm: NormalizedReceipt = normalizeReceiptOcr(raw);
      const engineUsed = "clova-ocr";

      await this.prisma.expenseReceipt.update({
        where: { id: receiptId },
        data: {
          ocrStatus: "DONE",
          ocrEngineUsed: preInfo ? `${engineUsed} [pre:${preInfo}]` : engineUsed,
          ocrRawJson: raw as any,
          ocrText: norm.fullText,
          extractedAmount: norm.amount ?? null,
          extractedMerchant: norm.merchantName ?? null,
          extractedDate: norm.transactedAt ?? null,
          ocrCompletedAt: new Date(),
        },
      });

      // 자동 매칭 후보 생성
      try {
        await this.suggestMatchesForReceipt(receiptId);
      } catch (err: any) {
        console.error(`[match-suggest] ${receiptId}:`, err.message);
      }
    } catch (err: any) {
      await this.prisma.expenseReceipt.update({
        where: { id: receiptId },
        data: { ocrStatus: "FAILED" },
      });
      throw err;
    }
  }
}
