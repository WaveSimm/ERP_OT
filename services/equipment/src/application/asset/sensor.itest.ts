import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { SensorService } from "./sensor.service";
import { PrismaSensorRepository } from "../../infrastructure/repositories/sensor.repository";

// sensor 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   CRUD(+category include) + 교정일 자동계산 + 상태전이 FSM.

const svc = new SensorService(new PrismaSensorRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

async function makeCategory(): Promise<string> {
  const c = await prisma.category.create({ data: { name: `cat-${Math.round(performance.now())}`, type: "SENSOR" } });
  return c.id;
}

describe("sensor.service (integration)", () => {
  it("create: 교정주기+교정일 → nextCalibrationDue 자동계산, category 포함 반환", async () => {
    const categoryId = await makeCategory();
    const s = await svc.create(
      { categoryId, name: "센서1", serialNumber: "SS-1", calibrationIntervalDays: 30, lastCalibratedAt: "2026-06-01" },
      "u1",
    );
    expect(s.category.id).toBe(categoryId);
    expect(s.nextCalibrationDue).not.toBeNull(); // +30일
  });

  it("getById: 없는 id throw / 있으면 calibrationDaysRemaining 포함", async () => {
    await expect(svc.getById("nope")).rejects.toThrow(/찾을 수 없습니다/);
    const categoryId = await makeCategory();
    const s = await svc.create({ categoryId, name: "센서", serialNumber: "SS-2" }, "u1");
    const found = await svc.getById(s.id);
    expect(found).toHaveProperty("calibrationDaysRemaining");
  });

  it("changeStatus: AVAILABLE→DEPLOYED 허용, 금지전이 throw", async () => {
    const categoryId = await makeCategory();
    const s = await svc.create({ categoryId, name: "센서", serialNumber: "SS-3" }, "u1");
    const deployed = await svc.changeStatus(s.id, "DEPLOYED");
    expect(deployed.status).toBe("DEPLOYED");
    await svc.changeStatus(s.id, "RETIRED");
    await expect(svc.changeStatus(s.id, "AVAILABLE")).rejects.toThrow(/허용되지 않습니다/);
  });

  it("update + remove(soft RETIRED)", async () => {
    const categoryId = await makeCategory();
    const s = await svc.create({ categoryId, name: "원본", serialNumber: "SS-4" }, "u1");
    const updated = await svc.update(s.id, { name: "수정" });
    expect(updated.name).toBe("수정");
    const retired = await svc.remove(s.id);
    expect(retired.status).toBe("RETIRED");
  });
});
