import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { PurchaseOrderService } from "./purchase-order.service";
import { PrismaPurchaseOrderRepository } from "../../infrastructure/repositories/purchase-order.repository";

// purchase-order 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   CRUD(orderNumber 자동·items nested) + receive($transaction: 입고→part 재고증가) 회귀검증.

const svc = new PurchaseOrderService(new PrismaPurchaseOrderRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

async function makePart(stock = 0): Promise<string> {
  const p = await prisma.part.create({ data: { partNumber: `PN-PO-${Math.round(performance.now())}`, name: "부품", stockQuantity: stock } });
  return p.id;
}

describe("purchase-order.service (integration)", () => {
  it("create: orderNumber 자동발급 + items nested + getById", async () => {
    const partId = await makePart();
    const po = await svc.create({
      supplier: "ACME",
      items: [{ partId, quantity: 10, unitPrice: 100, amount: 1000 }],
    });
    expect(po.orderNumber).toMatch(/^PO-/);
    expect(po.items).toHaveLength(1);

    const found = await svc.getById(po.id);
    expect(found.items[0]!.part.id).toBe(partId);
  });

  it("update: 상태/공급처 변경", async () => {
    const po = await svc.create({ supplier: "A" });
    const updated = await svc.update(po.id, { supplier: "B", status: "ORDERED" });
    expect(updated.supplier).toBe("B");
  });

  it("receive: 입고 시 part 재고 증가 + 상태 RECEIVED($transaction)", async () => {
    const partId = await makePart(5);
    const po = await svc.create({
      supplier: "ACME",
      items: [{ partId, quantity: 10, unitPrice: 100, amount: 1000 }],
    });
    const itemId = po.items[0]!.id;
    const received = await svc.receive(po.id, [{ itemId, receivedQuantity: 10 }]);
    expect(received.status).toBe("PO_RECEIVED");

    const part = await prisma.part.findUnique({ where: { id: partId } });
    expect(part?.stockQuantity).toBe(15); // 5 + 10
    const txns = await prisma.partTransaction.count({ where: { partId, type: "IN" } });
    expect(txns).toBe(1);
  });
});
