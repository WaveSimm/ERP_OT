import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const templates = [
    {
      code: "EXPENSE",
      name: "지출결의서",
      category: "GENERAL" as const,
      description: "일반 경비 지출 결의",
      fields: [
        { key: "project", label: "프로젝트", type: "text", required: false },
        { key: "paymentMethod", label: "결제 방법", type: "select", required: true, options: ["법인카드", "계좌이체", "현금"] },
      ],
      itemsTableConfig: {
        columns: ["description", "unitPrice", "quantity", "subtotal", "vat"],
        labels: { description: "내역", unitPrice: "단가", quantity: "수량", subtotal: "소계", vat: "부가세" },
      },
      postApprovalAction: "FINANCE_FORWARD" as const,
      sortOrder: 1,
    },
    {
      code: "PO",
      name: "구매 발주서",
      category: "PROCUREMENT" as const,
      description: "해외/국내 구매 발주 결재",
      fields: [
        { key: "orderNumber", label: "발주번호", type: "text", required: true },
        { key: "manufacturer", label: "제조사", type: "text", required: true },
        { key: "currency", label: "통화", type: "select", required: true, options: ["EUR", "GBP", "USD", "KRW"] },
      ],
      postApprovalAction: "ORDER_CONFIRM" as const,
      relatedService: "equipment-service",
      sortOrder: 2,
    },
    {
      code: "COST",
      name: "수입원가정산서",
      category: "PROCUREMENT" as const,
      description: "수입 물품 원가 정산",
      fields: [
        { key: "orderNumber", label: "발주번호", type: "text", required: true },
        { key: "invoiceNo", label: "Invoice No", type: "text", required: true },
      ],
      sortOrder: 3,
    },
    {
      code: "RELEASE",
      name: "출고의뢰서",
      category: "PROCUREMENT" as const,
      description: "재고 출고 결재",
      fields: [
        { key: "releaseReason", label: "출고 사유", type: "text", required: true },
        { key: "destination", label: "출고 목적지", type: "text", required: true },
      ],
      postApprovalAction: "INVENTORY_RELEASE" as const,
      relatedService: "equipment-service",
      sortOrder: 4,
    },
    {
      code: "LEAVE",
      name: "휴가신청서",
      category: "ATTENDANCE" as const,
      description: "연차/반차/1/4연차/가정의날/병가 등 휴가 신청",
      fields: [
        { key: "leaveType", label: "휴가 유형", type: "select", required: true,
          options: ["연차(1일)", "반차(4H)", "1/4연차(2H)", "가정의날(1H)", "가정의날(2H)", "병가", "경조사", "공가"] },
        { key: "startDate", label: "시작일", type: "date", required: true },
        { key: "endDate", label: "종료일", type: "date", required: true },
        // 시간 단위 휴가용 (v1.6: type별 endTime 자동 — startTime만 필요)
        { key: "startTime", label: "시작 시간 (시간 단위 휴가만)", type: "time", required: false },
        { key: "endTime", label: "종료 시간 (자동)", type: "time", required: false },
        { key: "reason", label: "사유", type: "textarea", required: true },
      ],
      postApprovalAction: "LEAVE_APPROVE" as const,
      relatedService: "attendance-service",
      sortOrder: 10,
    },
    {
      code: "OT",
      name: "휴일근무신청서",
      category: "ATTENDANCE" as const,
      description: "토/일/공휴일 근무 신청 (전일 8h 단위, 임금은 별도 시스템)",
      fields: [
        { key: "project", label: "관련 프로젝트", type: "text", required: false },
        { key: "task", label: "관련 태스크 (프로젝트 선택 시)", type: "text", required: false },
        { key: "workDates", label: "근무일 (토/일/공휴일, 여러 날짜 가능)", type: "date-multi", required: true },
        { key: "reason", label: "사유", type: "textarea", required: true },
      ],
      postApprovalAction: "OT_APPROVE" as const,
      relatedService: "attendance-service",
      sortOrder: 11,
    },
    {
      code: "TRIP",
      name: "출장신청서",
      category: "GENERAL" as const,
      description: "국내/해외 출장 신청",
      fields: [
        { key: "destination", label: "출장지", type: "text", required: true },
        { key: "startDate", label: "시작일", type: "date", required: true },
        { key: "endDate", label: "종료일", type: "date", required: true },
        { key: "purpose", label: "출장 목적", type: "textarea", required: true },
      ],
      sortOrder: 5,
    },
    {
      code: "REPORT",
      name: "업무보고서",
      category: "GENERAL" as const,
      description: "일반 업무 보고",
      fields: [
        { key: "reportType", label: "보고 유형", type: "select", required: true, options: ["일일", "주간", "월간", "특별"] },
      ],
      sortOrder: 20,
    },
    {
      // v1.6.4 (2026-05-16): 출장보고서 — 출장 결과 보고 + 경비 정산 묶음 연결 가능
      code: "TRIP_REPORT",
      name: "출장보고서",
      category: "GENERAL" as const,
      description: "출장 결과 보고 — 활동 내역 + 경비 명세 (정산 묶음 연결 가능)",
      fields: [
        // approval-ref: 본인의 결재 문서 dropdown (templateCode 매칭)
        { key: "tripApprovalDocId", label: "관련 출장신청서 (선택)", type: "approval-ref", required: false, meta: { templateCode: "TRIP" } },
        { key: "destination", label: "출장지", type: "text", required: true },
        { key: "startDate", label: "출장 시작일", type: "date", required: true },
        { key: "endDate", label: "출장 종료일", type: "date", required: true },
        { key: "companions", label: "동행자", type: "text", required: false },
        { key: "purpose", label: "출장 목적", type: "textarea", required: true },
        { key: "outcome", label: "활동 결과·성과", type: "textarea", required: true },
      ],
      itemsTableConfig: {
        columns: ["description", "unitPrice", "quantity", "subtotal", "vat"],
        labels: { description: "내역", unitPrice: "단가", quantity: "수량", subtotal: "소계", vat: "부가세" },
      },
      defaultBody: "",
      postApprovalAction: "FINANCE_FORWARD" as const,
      sortOrder: 6,
    },
  ];

  // 기존 code → 새 code 매핑 (마이그레이션)
  const CODE_MIGRATION: Record<string, string> = {
    PURCHASE_ORDER: "PO",
    COST_SETTLEMENT: "COST",
    INVENTORY_RELEASE: "RELEASE",
    OVERTIME: "OT",
    BUSINESS_TRIP: "TRIP",
    GENERAL_REPORT: "REPORT",
  };

  for (const [oldCode, newCode] of Object.entries(CODE_MIGRATION)) {
    const existing = await prisma.approvalTemplate.findUnique({ where: { code: oldCode } });
    if (existing) {
      // 새 code 템플릿이 이미 있으면 기존 것 삭제, 없으면 rename
      const newExists = await prisma.approvalTemplate.findUnique({ where: { code: newCode } });
      if (newExists) {
        // 기존 문서의 templateId를 새 템플릿으로 이전
        await prisma.approvalDocument.updateMany({
          where: { templateId: existing.id },
          data: { templateId: newExists.id },
        });
        await prisma.approvalTemplate.delete({ where: { code: oldCode } });
      } else {
        await prisma.approvalTemplate.update({
          where: { code: oldCode },
          data: { code: newCode },
        });
      }
    }
  }

  for (const t of templates) {
    await prisma.approvalTemplate.upsert({
      where: { code: t.code },
      update: { name: t.name, fields: t.fields, description: t.description },
      create: t as any,
    });
  }

  // 기존 문서번호 마이그레이션: OT-OLD_CODE-... → OT-NEW_CODE-...
  const DOC_NUM_MIGRATION: Record<string, string> = {
    "OT-PURCHASE_ORDER-": "OT-PO-",
    "OT-COST_SETTLEMENT-": "OT-COST-",
    "OT-INVENTORY_RELEASE-": "OT-RELEASE-",
    "OT-OVERTIME-": "OT-OT-",
    "OT-BUSINESS_TRIP-": "OT-TRIP-",
    "OT-GENERAL_REPORT-": "OT-REPORT-",
    // 이전 짧은 형식도 처리
    "EXPENSE-": "OT-EXPENSE-",
    "PURCHASE_ORDER-": "OT-PO-",
    "COST_SETTLEMENT-": "OT-COST-",
  };

  const allDocs = await prisma.approvalDocument.findMany({ select: { id: true, documentNumber: true } });
  for (const doc of allDocs) {
    let newNum = doc.documentNumber;
    for (const [oldPrefix, newPrefix] of Object.entries(DOC_NUM_MIGRATION)) {
      if (doc.documentNumber.startsWith(oldPrefix)) {
        newNum = newPrefix + doc.documentNumber.slice(oldPrefix.length);
        break;
      }
    }
    if (newNum !== doc.documentNumber) {
      await prisma.approvalDocument.update({
        where: { id: doc.id },
        data: { documentNumber: newNum },
      });
    }
  }

  console.log(`Seeded ${templates.length} approval templates, migrated ${allDocs.length} document numbers`);
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
