import { PrismaClient } from "@prisma/client";
import { InventoryService } from "./inventory.service.js";

/**
 * InboundRequest — 입고 대기 큐 (v1.6 신규, 2026-05-13)
 *
 * 모든 입고 요청을 단일 큐로 통합:
 *   - 해외/국내 발주 도착
 *   - 지출결의서 결재 완료 → 재무 접수 "재고 체크"
 *   - 경비정산 (드뭄)
 *   - 수동
 *
 * 자재 담당자가 한 화면에서 처리. 정보 보강 + InventoryItem 생성을 일관 흐름으로.
 *
 * Plan v1.6 §4.6.11 / Design v1.1 §19.1.5, §19.2.2 참고
 */

type InboundSourceType = "OVERSEAS_ORDER" | "PURCHASE_ORDER" | "EXPENSE_FOLLOWUP" | "EXPENSE_SETTLEMENT" | "MANUAL";
type InboundRequestStatus = "PENDING" | "RECEIVED" | "CANCELED";
type CompletenessFlag = "AUTO_MATCHED" | "PARTIAL" | "MANUAL_NEEDED";

interface InboundItemInput {
  productMasterId?: string;
  variantId?: string;
  itemNameRaw?: string;
  description?: string;
  quantity: number;
  unitPrice?: number;
  supplierId?: string;
  completenessFlag?: CompletenessFlag;
}

export class InboundRequestService {
  constructor(
    private prisma: PrismaClient,
    private inventoryService: InventoryService,
  ) {}

  /** 입고 코드 자동생성: IR-{YYMM}-{NNNN}, 월별 시퀀스 reset */
  private async generateCode(now: Date = new Date()): Promise<string> {
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const prefix = `IR-${yy}${mm}-`;

    const last = await this.prisma.inboundRequest.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: "desc" },
      select: { code: true },
    });
    let seq = 1;
    if (last) {
      const m = last.code.match(/^IR-\d{4}-(\d+)$/);
      if (m && m[1]) seq = parseInt(m[1], 10) + 1;
    }
    return `${prefix}${String(seq).padStart(4, "0")}`;
  }

  /** 큐 목록 — status 필터 + 페이지 */
  async list(params: {
    status?: InboundRequestStatus;
    sourceType?: InboundSourceType;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  } = {}) {
    const { status, sourceType, page = 1, limit = 50, sortBy, sortOrder = "desc" } = params;
    const where: any = {};
    if (status) where.status = status;
    if (sourceType) where.sourceType = sourceType;

    // v1.6 (2026-05-13)
    const SORTABLE: Record<string, any> = {
      code: { code: sortOrder },
      status: { status: sortOrder },
      sourceType: { sourceType: sortOrder },
      sourceDocNumber: { sourceDocNumber: sortOrder },
      requestedAt: { requestedAt: sortOrder },
    };
    const orderBy = sortBy && SORTABLE[sortBy] ? SORTABLE[sortBy] : [{ status: "asc" }, { requestedAt: "desc" }];

    const [items, total] = await Promise.all([
      this.prisma.inboundRequest.findMany({
        where,
        include: {
          items: { include: { variant: { include: { productMaster: true } } } },
          _count: { select: { items: true, inventoryItems: true } },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.inboundRequest.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getById(id: string) {
    const req = await this.prisma.inboundRequest.findUnique({
      where: { id },
      include: {
        items: { include: { variant: { include: { productMaster: true } } } },
        inventoryItems: { select: { id: true, inventoryNo: true, quantity: true, createdAt: true } },
      },
    });
    if (!req) throw new Error("InboundRequest를 찾을 수 없습니다.");
    return req;
  }

  /** 신규 InboundRequest 생성 (수동 또는 외부 서비스 호출) */
  async create(data: {
    sourceType: InboundSourceType;
    sourceId?: string;
    sourceDocNumber?: string;
    requesterId: string;
    notes?: string;
    items: InboundItemInput[];
  }) {
    if (data.items.length === 0) throw new Error("최소 1개 품목 필요");

    const code = await this.generateCode();
    return this.prisma.inboundRequest.create({
      data: {
        code,
        status: "PENDING",
        sourceType: data.sourceType,
        sourceId: data.sourceId ?? null,
        sourceDocNumber: data.sourceDocNumber ?? null,
        requesterId: data.requesterId,
        notes: data.notes ?? null,
        items: {
          create: data.items.map((it) => ({
            productMasterId: it.productMasterId ?? null,
            variantId: it.variantId ?? null,
            itemNameRaw: it.itemNameRaw ?? null,
            description: it.description ?? null,
            quantity: it.quantity,
            unitPrice: it.unitPrice ?? null,
            supplierId: it.supplierId ?? null,
            completenessFlag: it.completenessFlag ?? "MANUAL_NEEDED",
          })),
        },
      },
      include: { items: true },
    });
  }

  /**
   * 입고 처리 (PENDING → RECEIVED).
   *   각 receivedItems 입력 기준으로 InventoryItem 생성 (inventoryService.create 호출)
   *   request.status = RECEIVED 갱신
   *
   * 입력 형식:
   *   receivedItems: [{
   *     inboundRequestItemId,
   *     productMasterId, variantId, supplierId,  // 필수 보강
   *     unitPrice, quantity, locationId,
   *     serialNumber? (INDIVIDUAL 만)
   *     notes?
   *   }]
   */
  async receive(id: string, data: {
    receivedItems: Array<{
      inboundRequestItemId: string;
      productMasterId?: string;
      variantId?: string;
      supplierId?: string;
      unitPrice?: number;
      quantity: number;
      locationId?: string;
      serialNumber?: string;
      notes?: string;
    }>;
    receivedBy: string;
  }) {
    const req = await this.prisma.inboundRequest.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!req) throw new Error("InboundRequest를 찾을 수 없습니다.");
    if (req.status !== "PENDING") throw new Error(`이미 처리됨 (status=${req.status})`);

    const createdInventoryItems: any[] = [];

    return this.prisma.$transaction(async (tx) => {
      for (const r of data.receivedItems) {
        const reqItem = req.items.find((it) => it.id === r.inboundRequestItemId);
        if (!reqItem) throw new Error(`InboundRequestItem ${r.inboundRequestItemId} 없음`);

        // 우선순위: 입력 > requestItem 기본값
        const masterId = r.productMasterId ?? reqItem.productMasterId;
        const variantId = r.variantId ?? reqItem.variantId;
        const supplierId = r.supplierId ?? reqItem.supplierId;
        const unitPrice = r.unitPrice ?? Number(reqItem.unitPrice ?? 0);
        const totalAmount = unitPrice * r.quantity;

        // inventory.create는 트랜잭션 밖에서 호출 불가능하므로, 트랜잭션 안에서 직접 작성
        // generateInventoryNo는 inventoryService에 있으므로 그 로직 인라인 또는 reusable helper로 추출 필요
        // 여기선 단순화 — inventoryService.create() 활용 위해 트랜잭션 밖으로 빼야 함
        // 따라서 트랜잭션은 InboundRequest 상태만 갱신하고, inventory 생성은 별도 처리
        // → 아래 비-트랜잭션 패턴 사용

        // (트랜잭션 안에서는 inventoryNo 발급만 처리)
        const inventoryNo = await this.generateInventoryNoTx(tx);
        const item = await tx.inventoryItem.create({
          data: {
            inventoryNo,
            productMasterId: masterId ?? null,
            variantId: variantId ?? null,
            serialNumber: r.serialNumber ?? null,
            trackingMode: r.serialNumber ? "INDIVIDUAL" : "BULK",
            quantity: r.quantity,
            category: "PRODUCT",
            currentStatus: "IN_STOCK",
            unitPrice: unitPrice || null,
            totalAmount: totalAmount || null,
            totalAdditionalCost: 0,
            totalCostOfOwnership: totalAmount,
            supplierId: supplierId ?? null,
            inboundRequestId: id,
            sourceType: req.sourceType === "OVERSEAS_ORDER" ? "OVERSEAS_ORDER" : "EXPENSE_REQUEST",
            sourceId: req.sourceId ?? null,
            notes: r.notes ?? reqItem.description ?? null,
            createdBy: data.receivedBy,
          },
        });
        createdInventoryItems.push(item);

        // InventoryItemLocation 생성 (locationId 있을 때)
        if (r.locationId) {
          await tx.inventoryItemLocation.create({
            data: {
              inventoryItemId: item.id,
              locationId: r.locationId,
              quantity: r.quantity,
            },
          });
        }

        // 입고 트랜잭션 기록
        await tx.inventoryTransaction.create({
          data: {
            inventoryItemId: item.id,
            type: "PURCHASE",
            date: new Date(),
            quantity: r.quantity,
            toLocation: r.locationId ? "지정 위치" : null,
            notes: `InboundRequest ${req.code} 처리`,
            createdBy: data.receivedBy,
          },
        });
      }

      // 상태 갱신
      const updated = await tx.inboundRequest.update({
        where: { id },
        data: {
          status: "RECEIVED",
          receivedAt: new Date(),
          receivedBy: data.receivedBy,
        },
        include: {
          items: true,
          inventoryItems: { select: { id: true, inventoryNo: true } },
        },
      });

      // 출처별 후속 동기화 (v1.6, 2026-05-13)
      //  - EXPENSE_FOLLOWUP: 자재 담당자가 receive 처리하면 재무 후속처리도 COMPLETED로 전환
      if (req.sourceType === "EXPENSE_FOLLOWUP" && req.sourceId) {
        await tx.expenseFollowUp.updateMany({
          where: { id: req.sourceId },
          data: {
            status: "COMPLETED",
            inventoryItemId: createdInventoryItems[0]?.id ?? null,
          },
        });
      }

      return { ...updated, createdInventoryItems };
    });
  }

  /** 입고 요청 취소 */
  async cancel(id: string, reason?: string) {
    const req = await this.prisma.inboundRequest.findUnique({ where: { id } });
    if (!req) throw new Error("InboundRequest를 찾을 수 없습니다.");
    if (req.status !== "PENDING") throw new Error(`PENDING 상태에서만 취소 가능 (status=${req.status})`);

    return this.prisma.inboundRequest.update({
      where: { id },
      data: {
        status: "CANCELED",
        notes: reason ? `${req.notes ?? ""}\n[CANCEL] ${reason}`.trim() : req.notes,
      },
    });
  }

  /** 트랜잭션 내 inventoryNo 발급 (inventory.service의 generateInventoryNo 인라인) */
  private async generateInventoryNoTx(tx: any, now: Date = new Date()): Promise<string> {
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const prefix = `INV-${yy}${mm}-`;

    const last = await tx.inventoryItem.findFirst({
      where: { inventoryNo: { startsWith: prefix } },
      orderBy: { inventoryNo: "desc" },
      select: { inventoryNo: true },
    });
    let seq = 1;
    if (last) {
      const m = last.inventoryNo.match(/^INV-\d{4}-(\d+)$/);
      if (m && m[1]) seq = parseInt(m[1], 10) + 1;
    }
    return `${prefix}${String(seq).padStart(4, "0")}`;
  }
}
