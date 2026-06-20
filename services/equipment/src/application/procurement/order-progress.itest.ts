import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { OrderProgressService } from "./order-progress.service";
import { PrismaOrderProgressLogRepository } from "../../infrastructure/repositories/order-progress-log.repository";

// order-progress 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   CRUD + create 시 overseasOrder 진행률 갱신(cross) + 진행률 범위 가드.

const svc = new OrderProgressService(new PrismaOrderProgressLogRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

async function makeOrder(): Promise<string> {
  const contract = await prisma.contract.create({ data: { contractNumber: `CT-OP-${Date.now()}`, name: "c", client: "c" } });
  const order = await prisma.overseasOrder.create({
    data: { orderNumber: `OO-OP-${Date.now()}`, manufacturer: "M", contractId: contract.id, currency: "USD", orderedBy: "t", totalAmount: 1 },
  });
  return order.id;
}

describe("order-progress.service (integration)", () => {
  it("create: 로그 생성 + overseasOrder 진행률 갱신(cross) + list", async () => {
    const orderId = await makeOrder();
    await svc.create(orderId, { progress: 40, note: "생산중", updatedBy: "u1" });

    const order = await prisma.overseasOrder.findUnique({ where: { id: orderId } });
    expect(order?.productionProgress).toBe(40);

    const res = await svc.list(orderId);
    expect(res.total).toBe(1);
    expect(res.items[0]!.progress).toBe(40);
  });

  it("create: 진행률 0~100 범위 밖이면 throw", async () => {
    const orderId = await makeOrder();
    await expect(svc.create(orderId, { progress: 150, updatedBy: "u1" })).rejects.toThrow(/0~100/);
  });

  it("create: 없는 발주면 throw", async () => {
    await expect(svc.create("nope", { progress: 10, updatedBy: "u1" })).rejects.toThrow(/발주를 찾을 수 없습니다/);
  });

  it("remove: 삭제 / 없는 로그 throw", async () => {
    const orderId = await makeOrder();
    const log = await svc.create(orderId, { progress: 10, updatedBy: "u1" });
    await svc.remove(log.id);
    expect((await svc.list(orderId)).total).toBe(0);
    await expect(svc.remove("nope")).rejects.toThrow(/진행 이력/);
  });
});
