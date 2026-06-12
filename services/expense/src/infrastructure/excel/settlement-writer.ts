// 정산서 Excel 출력 — 계약별 sheet + 거래 라인 + 합계.
// v1.6.2 (2026-05-15): ExpenseCategory 폐기, 계약 snapshot(contractNumber/contractName) 기반 그룹

import ExcelJS from "exceljs";
import sharp from "sharp";
import type { Prisma } from "@prisma/client";

type SettlementWithItems = Prisma.ExpenseSettlementGetPayload<{
  include: {
    items: {
      include: {
        transaction: {
          include: {
            source: true;
            matches: { include: { receipt: true } };
          };
        };
      };
    };
  };
}>;

export async function buildSettlementWorkbook(
  s: SettlementWithItems,
  opts?: { loadReceipt?: (storageKey: string) => Promise<Buffer> },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "expense-service";
  wb.created = new Date();

  // ── 계약별 sheet ───────────────────────────────
  const byContract = new Map<string, typeof s.items>();
  for (const it of s.items) {
    const t = it.transaction;
    const key = t.contractNumber && t.contractName
      ? `${t.contractNumber} - ${t.contractName}`
      : t.contractNumber || t.contractName || "없음";
    if (!byContract.has(key)) byContract.set(key, []);
    byContract.get(key)!.push(it);
  }

  for (const [sheetName, items] of byContract) {
    // 계약 미지정("없음") 그룹의 시트명은 '내역'으로 표기
    const displayName = sheetName === "없음" ? "내역" : sheetName;
    const sh = wb.addWorksheet(displayName.slice(0, 31));
    sh.columns = [
      { header: "거래일시", key: "transactedAt", width: 20 },
      { header: "가맹점", key: "merchantName", width: 30 },
      { header: "사업(계약)", key: "contractLabel", width: 30 },
      // UI 용어 일치: detail 필드 = '구분', memo 필드 = '상세내역' (DB 필드명은 레거시)
      { header: "구분", key: "detail", width: 16 },
      { header: "상세내역", key: "memo", width: 36 },
      { header: "결제수단", key: "sourceName", width: 18 },
      { header: "금액", key: "amount", width: 14 },
      { header: "영수증", key: "receipt", width: 32 },
    ];
    sh.getRow(1).font = { bold: true };
    sh.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9ECEF" } };

    let subtotal = 0;
    for (const it of items) {
      const t = it.transaction;
      const confirmed = t.matches.find((m) => m.confirmedAt !== null);
      const receiptInfo = confirmed
        ? `${confirmed.receipt.extractedMerchant ?? "?"} ${
            confirmed.receipt.extractedAmount
              ? Number(confirmed.receipt.extractedAmount).toLocaleString() + "원"
              : ""
          }`.trim()
        : "";
      const contractLabel = t.contractNumber && t.contractName
        ? `${t.contractNumber} - ${t.contractName}`
        : t.contractNumber || t.contractName || "없음";
      sh.addRow({
        transactedAt: formatDateTime(t.transactedAt),
        merchantName: t.merchantName,
        contractLabel,
        detail: t.detail ?? "",
        sourceName: t.source.displayName ?? t.source.name,
        amount: Number(t.amount),
        memo: it.memoOverride ?? t.memo ?? "",
        receipt: receiptInfo,
      });
      subtotal += Number(t.amount);
    }

    // 합계 row
    const totalRow = sh.addRow({
      transactedAt: "",
      merchantName: "합계",
      contractLabel: "",
      sourceName: "",
      amount: subtotal,
      memo: "",
      receipt: "",
    });
    totalRow.font = { bold: true };
    totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } };

    sh.getColumn("amount").numFmt = "#,##0";
  }

  // ── 영수증 이미지 sheet — 비율 유지 + 글자 식별 가능 크기로 임베드 ──────────
  if (opts?.loadReceipt) {
    const rsheet = wb.addWorksheet("영수증");
    rsheet.getColumn(1).width = 80;
    let uiRow = 1;
    const titleCell = rsheet.getCell(uiRow, 1);
    titleCell.value = "영수증 이미지";
    titleCell.font = { bold: true, size: 14 };
    uiRow += 2;

    const DISP_W = 460;       // 표시 너비(px) — 영수증 글자 식별 가능 수준
    const MAX_DISP_H = 1100;  // 세로로 매우 긴 영수증 상한
    const ROW_PX = 20;        // 기본 행 높이(px) 근사 — 다음 영수증과 겹침 방지용
    let embedded = 0;

    for (const it of s.items) {
      const t = it.transaction;
      // 확정 매칭 우선, 없으면 매칭된 영수증(후보)도 포함
      const matched = t.matches.find((m) => m.confirmedAt !== null) ?? t.matches[0];
      const r = matched?.receipt;
      if (!r) continue;

      const contractLabel = t.contractNumber && t.contractName
        ? `${t.contractNumber} - ${t.contractName}`
        : t.contractNumber || t.contractName || "없음";
      const sourceName = t.source.displayName ?? t.source.name;
      const confirmTag = matched?.confirmedAt ? "" : "  (후보매칭)";
      const label = `${formatDateTime(t.transactedAt)}  |  ${t.merchantName}  |  ${Number(t.amount).toLocaleString()}원  |  ${sourceName}  |  ${contractLabel}${confirmTag}`;
      const labelCell = rsheet.getCell(uiRow, 1);
      labelCell.value = label;
      labelCell.font = { bold: true };
      uiRow += 1;

      if ((r.fileType ?? "").startsWith("image/")) {
        try {
          const raw = await opts.loadReceipt(r.fileUrl);
          // EXIF 회전 보정 + 과대 해상도 축소(파일 크기 억제) + jpeg 정규화(webp/gif 등도 호환)
          const norm = await sharp(raw).rotate().resize({ width: 1000, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
          const meta = await sharp(norm).metadata();
          const ow = meta.width ?? DISP_W;
          const oh = meta.height ?? DISP_W;
          let dispW = Math.min(DISP_W, ow);
          let dispH = Math.round(dispW * (oh / ow)); // 비율 유지
          if (dispH > MAX_DISP_H) { dispH = MAX_DISP_H; dispW = Math.round(dispH * (ow / oh)); }
          const imageId = wb.addImage({ base64: norm.toString("base64"), extension: "jpeg" });
          rsheet.addImage(imageId, {
            tl: { col: 0, row: uiRow - 1 }, // 0-based: 라벨 바로 아래
            ext: { width: dispW, height: dispH }, // 절대 px — 셀 크기와 무관, 비율 그대로
          });
          uiRow += Math.ceil(dispH / ROW_PX) + 3;
          embedded += 1;
        } catch (e) {
          rsheet.getCell(uiRow, 1).value = `(영수증 이미지 로드 실패: ${String(e).slice(0, 80)})`;
          uiRow += 2;
        }
      } else {
        // PDF 등 비이미지 — 이미지 임베드 불가, 안내만
        rsheet.getCell(uiRow, 1).value = `(영수증 파일 형식: ${r.fileType ?? "?"} — 엑셀 미리보기 불가, 원본 별도 확인)`;
        uiRow += 2;
      }
    }

    if (embedded === 0 && uiRow <= 4) {
      rsheet.getCell(4, 1).value = "첨부된 (확정 매칭) 영수증 이미지가 없습니다.";
    }
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

function formatDateTime(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}
