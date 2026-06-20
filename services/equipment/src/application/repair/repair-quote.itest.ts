import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { RepairQuoteService } from "./repair-quote.service";
import { PrismaRepairQuoteRepository } from "../../infrastructure/repositories/repair-quote.repository";

// repair-quote 통합테스트 — repository 전환 회귀 안전망(실 DB). aggregate(+items) + FSM.

const svc = new RepairQuoteService(new PrismaRepairQuoteRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

async function makeOrder(): Promise<string> {
  const o = await prisma.repairOrder.create({ data: { orderNumber: `AS-Q-${Date.now()}`, symptom: "x" } });
  return o.id;
}

describe("repair-quote.service (integration)", () => {
  it("create(nested items) + listByRepairOrder", async () => {
    const orderId = await makeOrder();
    await svc.create({
      repairOrderId: orderId, totalAmount: 3000,
      items: [{ description: "부품A", quantity: 2, unitPrice: 1000, amount: 2000 }],
    });
    const list = await svc.listByRepairOrder(orderId);
    expect(list).toHaveLength(1);
    expect(list[0]!.items).toHaveLength(1);
  });

  it("changeStatus: DRAFT→SENT→APPROVED(승인시각 기록), 금지전이 throw", async () => {
    const orderId = await makeOrder();
    const q = await svc.create({ repairOrderId: orderId, totalAmount: 100 });
    await expect(svc.changeStatus(q.id, "APPROVED")).rejects.toThrow(/허용되지 않습니다/); // DRAFT→APPROVED 금지
    await svc.changeStatus(q.id, "SENT");
    const approved = await svc.changeStatus(q.id, "APPROVED", "user-1");
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedBy).toBe("user-1");
  });

  it("items: add/update/remove (자식)", async () => {
    const orderId = await makeOrder();
    const q = await svc.create({ repairOrderId: orderId, totalAmount: 0 });
    const item = await svc.addItem(q.id, { description: "추가품", quantity: 1, unitPrice: 500, amount: 500 });
    const updated = await svc.updateItem(item.id, { quantity: 3, amount: 1500 });
    expect(updated.quantity).toBe(3);
    await svc.removeItem(item.id);
    expect(await prisma.quoteItem.count({ where: { quoteId: q.id } })).toBe(0);
  });

  it("remove: DRAFT만 삭제 가능(자식 함께 정리)", async () => {
    const orderId = await makeOrder();
    const q = await svc.create({
      repairOrderId: orderId, totalAmount: 100,
      items: [{ description: "x", quantity: 1, unitPrice: 100, amount: 100 }],
    });
    await svc.remove(q.id);
    expect(await svc.listByRepairOrder(orderId)).toHaveLength(0);
    expect(await prisma.quoteItem.count({ where: { quoteId: q.id } })).toBe(0);

    const orderId2 = await makeOrder();
    const sent = await svc.create({ repairOrderId: orderId2, totalAmount: 1 });
    await svc.changeStatus(sent.id, "SENT");
    await expect(svc.remove(sent.id)).rejects.toThrow(/DRAFT/);
  });
});
