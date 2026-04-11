import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import { writeFile, mkdir, unlink } from "fs/promises";
import { join, extname } from "path";
import sharp from "sharp";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "/app/uploads";
const MAX_LONG_SIDE = 2000;
const JPEG_QUALITY = 80;

const IMAGE_MIMES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/tiff",
]);

export class FileService {
  constructor(private prisma: PrismaClient) {}

  /** 이미지 최적화: 장변 2000px + JPEG 80% */
  private async optimizeImage(buffer: Buffer, mimeType: string): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!IMAGE_MIMES.has(mimeType)) {
      return { buffer, mimeType };
    }

    try {
      const meta = await sharp(buffer).metadata();
      const w = meta.width || 0;
      const h = meta.height || 0;
      const longSide = Math.max(w, h);

      let pipeline = sharp(buffer);

      if (longSide > MAX_LONG_SIDE) {
        pipeline = w >= h
          ? pipeline.resize({ width: MAX_LONG_SIDE, withoutEnlargement: true })
          : pipeline.resize({ height: MAX_LONG_SIDE, withoutEnlargement: true });
      }

      const optimized = await pipeline
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer();

      return { buffer: optimized, mimeType: "image/jpeg" };
    } catch {
      // 최적화 실패 시 원본 유지
      return { buffer, mimeType };
    }
  }

  async upload(data: {
    documentId?: string;
    referenceType?: string;
    referenceId?: string;
    fileName: string;
    fileBuffer: Buffer;
    mimeType: string;
    uploadedBy: string;
  }) {
    // 이미지 최적화
    const original = data.fileBuffer;
    const { buffer: optimized, mimeType } = await this.optimizeImage(data.fileBuffer, data.mimeType);

    const isOptimized = optimized !== original;
    let ext = extname(data.fileName);
    if (isOptimized && mimeType === "image/jpeg" && ext.toLowerCase() !== ".jpg" && ext.toLowerCase() !== ".jpeg") {
      ext = ".jpg";
    }

    const storageName = `${randomUUID()}${ext}`;
    const yearMonth = new Date().toISOString().slice(0, 7);
    const dir = join(UPLOAD_DIR, yearMonth);
    await mkdir(dir, { recursive: true });
    const storagePath = join(yearMonth, storageName);

    await writeFile(join(UPLOAD_DIR, storagePath), optimized);

    return this.prisma.attachment.create({
      data: {
        documentId: data.documentId ?? null,
        referenceType: data.referenceType as any ?? null,
        referenceId: data.referenceId ?? null,
        fileName: data.fileName,
        storagePath,
        fileSize: optimized.length,
        mimeType,
        uploadedBy: data.uploadedBy,
      },
    });
  }

  async listByDocument(documentId: string) {
    return this.prisma.attachment.findMany({
      where: { documentId },
      orderBy: { createdAt: "desc" },
    });
  }

  async listByReference(referenceType: string, referenceId: string) {
    return this.prisma.attachment.findMany({
      where: { referenceType: referenceType as any, referenceId },
      orderBy: { createdAt: "desc" },
    });
  }

  async remove(id: string) {
    const att = await this.prisma.attachment.findUnique({ where: { id } });
    if (!att) throw new Error("첨부파일을 찾을 수 없습니다.");

    try {
      await unlink(join(UPLOAD_DIR, att.storagePath));
    } catch {}

    return this.prisma.attachment.delete({ where: { id } });
  }

  getFilePath(storagePath: string): string {
    return join(UPLOAD_DIR, storagePath);
  }
}
