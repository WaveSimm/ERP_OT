import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { ShipmentService } from "./shipment.service";
import { PrismaShipmentRepository } from "../../infrastructure/repositories/shipment.repository";

// shipment 통합테스트 — repository 전환 회귀 안전망(실 DB). CRUD + 상태전이 FSM.

const svc = new ShipmentService(new PrismaShipmentRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

async function makeOrder(): Promise<string> {
  const o = await prisma.repairOrder.create({
    data: { orderNumber: `AS-SHIP-${Date.now()}`, symptom: "x" },
  });
  return o.id;
}

describe("shipment.service (integration)", () => {
  it("create + listByRepairOrder + getById(cross include)", async () => {
    const orderId = await makeOrder();
    const s = await svc.create({ repairOrderId: orderId, direction: "OUTBOUND", carrier: "DHL" });
    expect(s.status).toBe("PREPARING");

    const list = await svc.listByRepairOrder(orderId);
    expect(list).toHaveLength(1);

    const detail = await svc.getById(s.id);
    expect(detail.repairOrder.orderNumber).toContain("AS-SHIP-");
  });

  it("changeStatus: 허용 전이(PREPARING→SHIPPED) + shippedAt 자동기록", async () => {
    const orderId = await makeOrder();
    const s = await svc.create({ repairOrderId: orderId, direction: "OUTBOUND" });
    const shipped = await svc.changeStatus(s.id, "SHIPPED");
    expect(shipped.status).toBe("SHIPPED");
    expect(shipped.shippedAt).not.toBeNull();
  });

  it("changeStatus: 금지 전이(PREPARING→DELIVERED)는 throw", async () => {
    const orderId = await makeOrder();
    const s = await svc.create({ repairOrderId: orderId, direction: "OUTBOUND" });
    await expect(svc.changeStatus(s.id, "DELIVERED")).rejects.toThrow(/허용되지 않습니다/);
  });

  it("delete: 삭제", async () => {
    const orderId = await makeOrder();
    const s = await svc.create({ repairOrderId: orderId, direction: "INBOUND" });
    await svc.delete(s.id);
    expect(await svc.listByRepairOrder(orderId)).toHaveLength(0);
  });
});
