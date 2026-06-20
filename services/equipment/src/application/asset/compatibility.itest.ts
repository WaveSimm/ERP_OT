import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { CompatibilityService } from "./compatibility.service";
import { PrismaSensorCompatibilityRepository } from "../../infrastructure/repositories/sensor-compatibility.repository";

// compatibility 통합테스트 — repository 전환 회귀 안전망(실 DB).

const svc = new CompatibilityService(new PrismaSensorCompatibilityRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

async function makeCategory(type: string): Promise<string> {
  const c = await prisma.category.create({ data: { name: `cat-${type}-${Math.round(performance.now())}`, type } });
  return c.id;
}
async function makeEquipment(): Promise<string> {
  const categoryId = await makeCategory("EQUIPMENT");
  const e = await prisma.equipment.create({ data: { name: "장비", serialNumber: `SN-CMP-${Date.now()}`, createdBy: "t", categoryId } });
  return e.id;
}
async function makeSensor(): Promise<string> {
  const categoryId = await makeCategory("SENSOR");
  const s = await prisma.sensor.create({ data: { name: "센서", serialNumber: `SS-CMP-${Date.now()}`, createdBy: "t", categoryId } });
  return s.id;
}

describe("compatibility.service (integration)", () => {
  it("create + listByEquipment + listBySensor (cross include)", async () => {
    const eqId = await makeEquipment();
    const snId = await makeSensor();
    const c = await svc.create({ equipmentId: eqId, sensorId: snId, notes: "호환" });
    expect(c.id).toBeTruthy();

    const byEq = await svc.listByEquipment(eqId);
    expect(byEq).toHaveLength(1);
    const bySn = await svc.listBySensor(snId);
    expect(bySn).toHaveLength(1);
  });

  it("remove: 삭제", async () => {
    const eqId = await makeEquipment();
    const snId = await makeSensor();
    const c = await svc.create({ equipmentId: eqId, sensorId: snId });
    await svc.remove(c.id);
    expect(await svc.listByEquipment(eqId)).toHaveLength(0);
  });
});
