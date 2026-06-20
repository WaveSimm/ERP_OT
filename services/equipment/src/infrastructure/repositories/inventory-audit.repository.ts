import { PrismaClient, Prisma, InventoryAudit, InventoryAuditItem } from "@prisma/client";
import type { IInventoryAuditRepository, InventoryAuditWithCount } from "../../domain/repositories/inventory-audit.repository.js";

/** IInventoryAuditRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaInventoryAuditRepository implements IInventoryAuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<InventoryAudit | null> {
    return this.prisma.inventoryAudit.findUnique({ where: { id } });
  }

  create(data: Prisma.InventoryAuditUncheckedCreateInput): Promise<InventoryAuditWithCount> {
    return this.prisma.inventoryAudit.create({ data, include: { _count: { select: { items: true } } } });
  }

  update(id: string, data: Prisma.InventoryAuditUncheckedUpdateInput): Promise<InventoryAudit> {
    return this.prisma.inventoryAudit.update({ where: { id }, data });
  }

  findItemById(itemId: string): Promise<InventoryAuditItem | null> {
    return this.prisma.inventoryAuditItem.findUnique({ where: { id: itemId } });
  }

  updateItem(itemId: string, data: Prisma.InventoryAuditItemUncheckedUpdateInput): Promise<InventoryAuditItem> {
    return this.prisma.inventoryAuditItem.update({ where: { id: itemId }, data });
  }
}
