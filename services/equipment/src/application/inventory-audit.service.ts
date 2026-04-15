import { PrismaClient, AuditStatus, AuditItemStatus } from "@prisma/client";

export class InventoryAuditService {
  constructor(private prisma: PrismaClient) {}

  /** 실사 목록 */
  async list() {
    return this.prisma.inventoryAudit.findMany({
      orderBy: { plannedDate: "desc" },
      include: { _count: { select: { items: true } } },
    });
  }

  /** 실사 상세 */
  async getById(id: string) {
    const audit = await this.prisma.inventoryAudit.findUnique({
      where: { id },
      include: {
        items: {
          include: { inventoryItem: { select: { id: true, inventoryNo: true, productMaster: { select: { name: true } } } } },
          orderBy: { inventoryItem: { inventoryNo: "asc" } },
        },
      },
    });
    if (!audit) throw new Error("실사를 찾을 수 없습니다.");
    return audit;
  }

  /** 실사 생성 (전체 재고 자동 포함) */
  async create(data: { name: string; plannedDate: string; notes?: string; createdBy: string }) {
    const allItems = await this.prisma.inventoryItem.findMany({
      where: { currentStatus: { not: "RELEASED" } },
      select: { id: true, quantity: true, currentLocation: true },
    });

    return this.prisma.inventoryAudit.create({
      data: {
        name: data.name,
        plannedDate: new Date(data.plannedDate),
        notes: data.notes ?? null,
        createdBy: data.createdBy,
        items: {
          create: allItems.map(item => ({
            inventoryItemId: item.id,
            systemQuantity: item.quantity,
            systemLocation: item.currentLocation,
          })),
        },
      },
      include: { _count: { select: { items: true } } },
    });
  }

  /** 실사 시작 */
  async start(id: string) {
    return this.prisma.inventoryAudit.update({
      where: { id },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
    });
  }

  /** 실사 항목 체크 */
  async checkItem(itemId: string, data: {
    actualQuantity: number;
    actualLocation?: string;
    checkedBy: string;
    notes?: string;
  }) {
    const item = await this.prisma.inventoryAuditItem.findUnique({ where: { id: itemId } });
    if (!item) throw new Error("실사 항목을 찾을 수 없습니다.");

    const matched = data.actualQuantity === item.systemQuantity;
    const status: AuditItemStatus = data.actualQuantity === 0 ? "MISSING" : matched ? "MATCHED" : "MISMATCHED";

    return this.prisma.inventoryAuditItem.update({
      where: { id: itemId },
      data: {
        actualQuantity: data.actualQuantity,
        actualLocation: data.actualLocation ?? null,
        status,
        checkedBy: data.checkedBy,
        checkedAt: new Date(),
        notes: data.notes ?? null,
      },
    });
  }

  /** 실사 항목 리셋 (미확인으로 되돌리기) */
  async resetItem(itemId: string) {
    const item = await this.prisma.inventoryAuditItem.findUnique({ where: { id: itemId } });
    if (!item) throw new Error("실사 항목을 찾을 수 없습니다.");

    return this.prisma.inventoryAuditItem.update({
      where: { id: itemId },
      data: {
        actualQuantity: null,
        actualLocation: null,
        status: "PENDING",
        checkedBy: null,
        checkedAt: null,
        notes: null,
      },
    });
  }

  /** 실사 일시정지 */
  async pause(id: string) {
    const audit = await this.prisma.inventoryAudit.findUnique({ where: { id } });
    if (!audit) throw new Error("실사를 찾을 수 없습니다.");
    if (audit.status !== "IN_PROGRESS") throw new Error("진행중인 실사만 일시정지할 수 있습니다.");

    return this.prisma.inventoryAudit.update({
      where: { id },
      data: { status: "PAUSED" },
    });
  }

  /** 실사 재개 */
  async resume(id: string) {
    const audit = await this.prisma.inventoryAudit.findUnique({ where: { id } });
    if (!audit) throw new Error("실사를 찾을 수 없습니다.");
    if (audit.status !== "PAUSED") throw new Error("일시정지된 실사만 재개할 수 있습니다.");

    return this.prisma.inventoryAudit.update({
      where: { id },
      data: { status: "IN_PROGRESS" },
    });
  }

  /** 실사 취소 */
  async cancel(id: string) {
    const audit = await this.prisma.inventoryAudit.findUnique({ where: { id } });
    if (!audit) throw new Error("실사를 찾을 수 없습니다.");
    if (audit.status === "COMPLETED" || audit.status === "CANCELLED") {
      throw new Error("완료되었거나 이미 취소된 실사는 취소할 수 없습니다.");
    }

    return this.prisma.inventoryAudit.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
  }

  /** 실사 완료 */
  async complete(id: string) {
    const audit = await this.prisma.inventoryAudit.findUnique({
      where: { id },
      include: { items: { select: { status: true } } },
    });
    if (!audit) throw new Error("실사를 찾을 수 없습니다.");
    if (audit.status !== "IN_PROGRESS") throw new Error("진행중인 실사만 완료할 수 있습니다.");

    const pendingCount = audit.items.filter(i => i.status === "PENDING").length;
    if (pendingCount > 0) {
      throw new Error(`미확인 항목이 ${pendingCount}건 있습니다. 모든 항목을 확인한 후 완료해주세요.`);
    }

    return this.prisma.inventoryAudit.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }
}
