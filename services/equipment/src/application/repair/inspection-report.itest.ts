import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { InspectionReportService } from "./inspection-report.service";
import { PrismaInspectionReportRepository } from "../../infrastructure/repositories/inspection-report.repository";

// inspection-report 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   create/update + decision의 RepairOrder sync(cross-aggregate) 검증.

const svc = new InspectionReportService(new PrismaInspectionReportRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

async function makeOrder(status?: string): Promise<string> {
  const o = await prisma.repairOrder.create({
    data: { orderNumber: `AS-INS-${Date.now()}-${Math.round(performance.now())}`, symptom: "x", ...(status ? { status: status as never } : {}) },
  });
  return o.id;
}

describe("inspection-report.service (integration)", () => {
  it("create + getByRepairOrder", async () => {
    const orderId = await makeOrder();
    await svc.create({ repairOrderId: orderId, symptom: "소음", inspectorName: "김기사" });
    const found = await svc.getByRepairOrder(orderId);
    expect(found?.symptom).toBe("소음");
  });

  it("create with decision → RepairOrder.decision1st 동기화(cross-aggregate)", async () => {
    const orderId = await makeOrder("INSPECTING_1ST");
    await svc.create({ repairOrderId: orderId, decision: "IN_HOUSE_REPAIR", decisionReason: "수리가능" });
    const order = await prisma.repairOrder.findUnique({ where: { id: orderId } });
    expect(order?.decision1st).toBe("IN_HOUSE_REPAIR");
    expect(order?.decision1stReason).toBe("수리가능");
  });

  it("update with decision (2차 단계) → decision2nd 동기화", async () => {
    const orderId = await makeOrder("INSPECTING_2ND");
    const r = await svc.create({ repairOrderId: orderId, symptom: "재점검" });
    await svc.update(r.id, { decision: "KEEP_AS_IS", decisionReason: "불가" });
    const order = await prisma.repairOrder.findUnique({ where: { id: orderId } });
    expect(order?.decision2nd).toBe("KEEP_AS_IS");
  });
});
