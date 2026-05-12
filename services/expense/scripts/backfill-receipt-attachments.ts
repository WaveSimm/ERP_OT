// 일회성 백필 스크립트.
// 이미 상신된 정산서들의 매칭 영수증을 approval-service에 첨부 파일로 업로드.
//
// 실행: docker exec erp-ot-expense node /tmp/backfill.js
// 또는 dev: tsx scripts/backfill-receipt-attachments.ts

import { PrismaClient } from "@prisma/client";
import { promises as fs } from "fs";
import path from "path";

const prisma = new PrismaClient();

const APPROVAL_URL = process.env.APPROVAL_SERVICE_URL || "http://approval-service:3006";
const TOKEN = process.env.INTERNAL_API_TOKEN!;
const UPLOAD_ROOT = process.env.EXPENSE_ATTACHMENT_DIR || "/app/uploads";

async function uploadOne(documentId: string, uploadedBy: string, receiptId: string) {
  const r = await prisma.expenseReceipt.findUnique({ where: { id: receiptId } });
  if (!r) {
    console.log(`  ⚠ receipt ${receiptId} not found`);
    return;
  }
  const diskPath = path.join(UPLOAD_ROOT, r.storageKey);
  const buf = await fs.readFile(diskPath);

  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(buf)], { type: r.fileType }), r.originalFileName);
  fd.append("documentId", documentId);
  fd.append("uploadedBy", uploadedBy);

  const res = await fetch(`${APPROVAL_URL}/internal/files/upload`, {
    method: "POST",
    headers: { "X-Internal-Token": TOKEN },
    body: fd,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.log(`  ✗ ${r.originalFileName} 실패 (HTTP ${res.status}): ${txt.slice(0, 100)}`);
    return;
  }
  console.log(`  ✓ ${r.originalFileName} 첨부 완료`);
}

async function main() {
  // 이미 상신된 정산서 + 매칭된 영수증 + 영수증 파일 경로
  const settlements = await prisma.expenseSettlement.findMany({
    where: { status: { in: ["SUBMITTED", "APPROVED", "RECEIVED", "PAID"] }, approvalDocumentId: { not: null } },
    include: {
      items: {
        include: {
          transaction: {
            include: {
              matches: {
                where: { confirmedAt: { not: null } },
                include: { receipt: true },
              },
            },
          },
        },
      },
    },
  });

  console.log(`백필 대상 정산서: ${settlements.length}건`);
  for (const s of settlements) {
    const receiptIds = new Set<string>();
    for (const it of s.items) {
      for (const m of it.transaction.matches ?? []) {
        if (m.receipt) receiptIds.add(m.receipt.id);
      }
    }
    if (receiptIds.size === 0) {
      console.log(`\n[${s.title}] 매칭 영수증 없음 — skip`);
      continue;
    }
    console.log(`\n[${s.title}] docId=${s.approvalDocumentId} / 영수증 ${receiptIds.size}매`);
    for (const rid of receiptIds) {
      await uploadOne(s.approvalDocumentId!, s.userId, rid);
    }
  }

  console.log("\n백필 완료.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
