import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { OverseasOrderService } from "./overseas-order.service";
import { PrismaOverseasOrderRepository } from "../../infrastructure/repositories/overseas-order.repository";

// overseas-order 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   CRUD(orderNumber·items nested·contract include) + 상태전이(FSM) + item 자식 CRUD + remove 가드.

const svc = new OverseasOrderService(new PrismaOverseasOrderRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

async function makeContract(): Promise<string> {
  const c = await prisma.contract.create({ data: { contractNumber: `CT-OO-${Math.round(performance.now())}`, name: "c", client: "c" } });
  return c.id;
}

describe("overseas-order.service (integration)", () => {
  it("create: orderNumber 자동(PO-)·DRAFT·items nested·contract 포함 + getById", async () => {
    const contractId = await makeContract();
    const o = await svc.create({
      contractId, manufacturer: "ACME", currency: "USD", orderedBy: "u1", totalAmount: 1000,
      items: [{ name: "품목A", quantity: 2, unitPrice: 500, amount: 1000 }],
    });
    expect(o.orderNumber).toMatch(/^PO-/);
    expect(o.status).toBe("DRAFT");
    expect(o.items).toHaveLength(1);

    const found = await svc.getById(o.id);
    expect(found.contract.id).toBe(contractId);
    expect(found.allowedTransitions).toBeDefined();
  });

  it("update + transition(FSM) DRAFT→PENDING_APPROVAL", async () => {
    const contractId = await makeContract();
    const o = await svc.create({ contractId, manufacturer: "M", currency: "USD", orderedBy: "u1", totalAmount: 1 });
    const updated = await svc.update(o.id, { manufacturer: "M2" });
    expect(updated.manufacturer).toBe("M2");
    const moved = await svc.transition(o.id, "PENDING_APPROVAL", "u1");
    expect(moved.status).toBe("PENDING_APPROVAL");
  });

  it("transition: 금지 전이는 throw(FSM)", async () => {
    const contractId = await makeContract();
    const o = await svc.create({ contractId, manufacturer: "M", currency: "USD", orderedBy: "u1", totalAmount: 1 });
    await expect(svc.transition(o.id, "ARRIVED", "u1")).rejects.toThrow();
  });

  it("items: add/update/remove (자식, 상태 가드)", async () => {
    const contractId = await makeContract();
    const o = await svc.create({ contractId, manufacturer: "M", currency: "USD", orderedBy: "u1", totalAmount: 1 });
    const item = await svc.addItem(o.id, { name: "추가품", quantity: 1, unitPrice: 100, amount: 100 });
    const updated = await svc.updateItem(item.id, { quantity: 5, amount: 500 });
    expect(updated.quantity).toBe(5);
    await svc.removeItem(item.id);
    expect(await prisma.overseasOrderItem.count({ where: { orderId: o.id } })).toBe(0);
  });

  it("remove: DRAFT만 삭제 가능", async () => {
    const contractId = await makeContract();
    const o = await svc.create({ contractId, manufacturer: "M", currency: "USD", orderedBy: "u1", totalAmount: 1 });
    await svc.remove(o.id);
    await expect(svc.getById(o.id)).rejects.toThrow(/찾을 수 없습니다/);

    const o2 = await svc.create({ contractId, manufacturer: "M", currency: "USD", orderedBy: "u1", totalAmount: 1 });
    await svc.transition(o2.id, "PENDING_APPROVAL", "u1");
    await expect(svc.remove(o2.id)).rejects.toThrow(/초안 상태/);
  });
});
