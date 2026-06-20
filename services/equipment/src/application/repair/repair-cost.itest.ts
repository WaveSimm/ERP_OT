import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { RepairCostService } from "./repair-cost.service";
import { PrismaRepairCostRepository } from "../../infrastructure/repositories/repair-cost.repository";

// repair-cost 통합테스트 — repository 전환 회귀 안전망(실 DB).

const svc = new RepairCostService(new PrismaRepairCostRepository(prisma));

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

// FK: RepairCost.repairOrderId → RepairOrder. 테스트용 order 생성 헬퍼.
async function makeOrder(): Promise<string> {
  const o = await prisma.repairOrder.create({
    data: { orderNumber: `AS-COST-${Date.now()}`, symptom: "x" },
  });
  return o.id;
}

describe("repair-cost.service (integration)", () => {
  it("create + listByRepairOrder", async () => {
    const orderId = await makeOrder();
    await svc.create({ repairOrderId: orderId, costType: "PARTS", amount: 1000 });
    await svc.create({ repairOrderId: orderId, costType: "LABOR", amount: 2000 });

    const list = await svc.listByRepairOrder(orderId);
    expect(list).toHaveLength(2);
    expect(list.map((c) => Number(c.amount)).sort()).toEqual([1000, 2000]);
  });

  it("update: 금액/설명 변경", async () => {
    const orderId = await makeOrder();
    const c = await svc.create({ repairOrderId: orderId, costType: "PARTS", amount: 500 });
    const updated = await svc.update(c.id, { amount: 999, description: "수정" });
    expect(Number(updated.amount)).toBe(999);
    expect(updated.description).toBe("수정");
  });

  it("remove: 삭제", async () => {
    const orderId = await makeOrder();
    const c = await svc.create({ repairOrderId: orderId, costType: "PARTS", amount: 100 });
    await svc.remove(c.id);
    expect(await svc.listByRepairOrder(orderId)).toHaveLength(0);
  });
});
