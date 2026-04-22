import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const templates = [
  {
    code: "IMPORT_DECLARATION",
    name: "수입면장",
    description: "수입신고필증 (수입면장) — 관세청 발행 통관 문서",
    targetService: "equipment-service",
    targetEndpoint: "/api/v1/procurement/settlements",
    fields: [
      { key: "declarationNo", label: "면장번호", aliases: ["신고번호", "면장No", "수입신고번호"], type: "STRING", required: true, erpFieldName: "declarationNo" },
      { key: "declarationDate", label: "신고일자", aliases: ["신고일", "수입일자"], type: "DATE", required: true, erpFieldName: "declarationDate" },
      { key: "supplier", label: "공급자", aliases: ["수출자", "해외공급자", "Shipper", "무역거래처", "거래처"], type: "STRING", required: true, erpFieldName: "supplier" },
      { key: "currency", label: "통화", aliases: ["Currency", "결제통화", "결제금액"], type: "STRING", required: false, erpFieldName: "currency" },
      { key: "totalImportCost", label: "수입원가", aliases: ["CIF금액", "수입가액", "총과세가격", "과세가격"], type: "NUMBER", required: true, erpFieldName: "totalImportCost" },
      { key: "supplyAmount", label: "공급가액", aliases: ["과세표준", "결제금액인도", "인도조건가격"], type: "NUMBER", required: true, erpFieldName: "supplyAmount" },
      { key: "vat", label: "부가세", aliases: ["부가가치세", "VAT", "부가가치세과"], type: "NUMBER", required: true, erpFieldName: "vat" },
      { key: "customsDuty", label: "관세", aliases: ["관세액", "Customs Duty", "세종"], type: "NUMBER", required: false, erpFieldName: null },
      { key: "domesticTransport", label: "국내운반비", aliases: ["국내운송비", "내륙운송", "내륙운반비"], type: "NUMBER", required: false, erpFieldName: null },
      { key: "overseasTransport", label: "국외운반비", aliases: ["국외운송비", "해상운임", "Freight", "운임"], type: "NUMBER", required: false, erpFieldName: null },
      { key: "brokerageFee", label: "통관수수료", aliases: ["관세사수수료", "Brokerage", "통관료"], type: "NUMBER", required: false, erpFieldName: null },
      { key: "itemName", label: "품목명", aliases: ["품명", "상품명", "Description", "거래품명"], type: "STRING", required: false, erpFieldName: null },
      { key: "itemQty", label: "수량", aliases: ["Quantity", "Qty", "수입수량", "총포장갯수"], type: "NUMBER", required: false, erpFieldName: null },
      { key: "itemAmount", label: "금액", aliases: ["Amount", "총금액", "금역"], type: "NUMBER", required: false, erpFieldName: null },
    ],
  },
  {
    code: "TAX_INVOICE",
    name: "세금계산서",
    description: "전자세금계산서 — 공급자 발행",
    targetService: "equipment-service",
    targetEndpoint: "/api/v1/procurement/settlements",
    fields: [
      { key: "invoiceNo", label: "계산서번호", aliases: ["승인번호", "일련번호"], type: "STRING", required: true, erpFieldName: null },
      { key: "issueDate", label: "작성일자", aliases: ["발행일", "발급일자"], type: "DATE", required: true, erpFieldName: null },
      { key: "supplierName", label: "공급자", aliases: ["공급하는자", "상호"], type: "STRING", required: true, erpFieldName: null },
      { key: "bizNumber", label: "사업자번호", aliases: ["사업자등록번호", "등록번호"], type: "BIZ_NO", required: true, erpFieldName: null },
      { key: "supplyAmount", label: "공급가액", aliases: ["공급가", "과세표준"], type: "NUMBER", required: true, erpFieldName: null },
      { key: "taxAmount", label: "세액", aliases: ["부가세", "VAT"], type: "NUMBER", required: true, erpFieldName: null },
      { key: "totalAmount", label: "합계금액", aliases: ["합계", "총액", "청구금액"], type: "NUMBER", required: true, erpFieldName: null },
    ],
  },
  {
    code: "QUOTATION",
    name: "견적서",
    description: "공급자 발행 견적서",
    targetService: "equipment-service",
    targetEndpoint: "/api/v1/procurement/orders",
    fields: [
      { key: "quoteNo", label: "견적번호", aliases: ["견적서번호", "Quotation No"], type: "STRING", required: true, erpFieldName: null },
      { key: "quoteDate", label: "견적일자", aliases: ["일자", "Date"], type: "DATE", required: true, erpFieldName: null },
      { key: "supplierName", label: "공급자", aliases: ["상호", "업체명", "Company"], type: "STRING", required: true, erpFieldName: null },
      { key: "validUntil", label: "유효기간", aliases: ["유효일", "Valid Until"], type: "DATE", required: false, erpFieldName: null },
      { key: "itemName", label: "품명", aliases: ["품목", "Description", "Item"], type: "STRING", required: false, erpFieldName: null },
      { key: "quantity", label: "수량", aliases: ["Qty", "Quantity"], type: "NUMBER", required: false, erpFieldName: null },
      { key: "unitPrice", label: "단가", aliases: ["Unit Price", "Price"], type: "CURRENCY", required: false, erpFieldName: null },
      { key: "totalAmount", label: "합계", aliases: ["총액", "Total", "합계금액"], type: "CURRENCY", required: true, erpFieldName: null },
    ],
  },
  {
    code: "INVOICE",
    name: "인보이스",
    description: "해외 공급자 발행 Commercial Invoice",
    targetService: "equipment-service",
    targetEndpoint: "/api/v1/procurement/orders",
    fields: [
      { key: "invoiceNo", label: "Invoice No", aliases: ["Invoice Number", "Inv No", "인보이스번호"], type: "STRING", required: true, erpFieldName: "invoiceNo" },
      { key: "invoiceDate", label: "Date", aliases: ["Invoice Date", "일자"], type: "DATE", required: true, erpFieldName: null },
      { key: "supplierName", label: "Supplier", aliases: ["From", "Seller", "공급자", "제조사"], type: "STRING", required: true, erpFieldName: null },
      { key: "currency", label: "Currency", aliases: ["통화", "Ccy"], type: "STRING", required: false, erpFieldName: null },
      { key: "itemName", label: "Description", aliases: ["Item", "Product", "품명"], type: "STRING", required: false, erpFieldName: null },
      { key: "quantity", label: "Qty", aliases: ["Quantity", "수량"], type: "NUMBER", required: false, erpFieldName: null },
      { key: "unitPrice", label: "Unit Price", aliases: ["Price", "단가"], type: "CURRENCY", required: false, erpFieldName: null },
      { key: "totalAmount", label: "Total", aliases: ["Total Amount", "Grand Total", "합계"], type: "CURRENCY", required: true, erpFieldName: null },
      { key: "paymentTerms", label: "Payment Terms", aliases: ["Terms", "결제조건"], type: "STRING", required: false, erpFieldName: null },
    ],
  },
  {
    code: "DELIVERY_NOTE",
    name: "거래명세서",
    description: "거래명세서/거래명세표 — 납품 시 발행",
    targetService: "equipment-service",
    targetEndpoint: "/api/v1/inventory/items",
    fields: [
      { key: "noteNo", label: "명세서번호", aliases: ["거래명세서번호", "No"], type: "STRING", required: true, erpFieldName: null },
      { key: "noteDate", label: "일자", aliases: ["거래일자", "Date"], type: "DATE", required: true, erpFieldName: null },
      { key: "supplierName", label: "공급자", aliases: ["상호", "업체명"], type: "STRING", required: true, erpFieldName: null },
      { key: "itemName", label: "품명", aliases: ["품목", "상품명"], type: "STRING", required: false, erpFieldName: null },
      { key: "quantity", label: "수량", aliases: ["Qty"], type: "NUMBER", required: false, erpFieldName: null },
      { key: "unitPrice", label: "단가", aliases: ["Price"], type: "NUMBER", required: false, erpFieldName: null },
      { key: "totalAmount", label: "합계", aliases: ["합계금액", "Total"], type: "NUMBER", required: true, erpFieldName: null },
    ],
  },
  {
    code: "PURCHASE_ORDER",
    name: "발주서",
    description: "발주서/Purchase Order",
    targetService: "equipment-service",
    targetEndpoint: "/api/v1/procurement/orders",
    fields: [
      { key: "poNo", label: "발주번호", aliases: ["PO No", "Purchase Order No", "P.O. No"], type: "STRING", required: true, erpFieldName: null },
      { key: "poDate", label: "발주일", aliases: ["Date", "일자", "발주일자"], type: "DATE", required: true, erpFieldName: null },
      { key: "supplierName", label: "발주처", aliases: ["공급자", "Supplier", "Vendor"], type: "STRING", required: true, erpFieldName: null },
      { key: "itemName", label: "품명", aliases: ["Description", "Item", "품목"], type: "STRING", required: false, erpFieldName: null },
      { key: "quantity", label: "수량", aliases: ["Qty", "Quantity"], type: "NUMBER", required: false, erpFieldName: null },
      { key: "unitPrice", label: "단가", aliases: ["Unit Price", "Price"], type: "CURRENCY", required: false, erpFieldName: null },
      { key: "totalAmount", label: "합계", aliases: ["Total", "합계금액", "총액"], type: "CURRENCY", required: true, erpFieldName: null },
      { key: "deliveryDate", label: "납기일", aliases: ["Delivery Date", "납품일", "Expected Delivery"], type: "DATE", required: false, erpFieldName: null },
    ],
  },
];

async function main() {
  console.log("Seeding OCR templates...");

  for (const t of templates) {
    const existing = await prisma.documentTemplate.findUnique({ where: { code: t.code } });
    if (existing) {
      console.log(`  [SKIP] ${t.code} — already exists`);
      continue;
    }

    await prisma.documentTemplate.create({
      data: {
        code: t.code,
        name: t.name,
        description: t.description,
        targetService: t.targetService,
        targetEndpoint: t.targetEndpoint,
        fields: {
          createMany: {
            data: t.fields.map((f, i) => ({
              key: f.key,
              label: f.label,
              aliases: f.aliases,
              type: f.type as any,
              required: f.required,
              sortOrder: i,
              erpFieldName: f.erpFieldName,
            })),
          },
        },
      },
    });
    console.log(`  [OK] ${t.code} (${t.name}) — ${t.fields.length} fields`);
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
