import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { ScheduleService } from "./schedule.service";
import { PrismaAssetScheduleRepository } from "../../infrastructure/repositories/asset-schedule.repository";

// schedule 통합테스트 — repository 전환 회귀 안전망(실 DB). CRUD + 일정 충돌 검사.

const svc = new ScheduleService(new PrismaAssetScheduleRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

async function makeEquipment(): Promise<string> {
  const cat = await prisma.category.create({ data: { name: `cat-${Math.round(performance.now())}`, type: "EQUIPMENT" } });
  const e = await prisma.equipment.create({ data: { name: "장비", serialNumber: `SN-SCH-${Date.now()}`, createdBy: "t", categoryId: cat.id } });
  return e.id;
}

describe("schedule.service (integration)", () => {
  it("create + listByEquipment", async () => {
    const eqId = await makeEquipment();
    await svc.create({ equipmentId: eqId, title: "정비1", startDate: "2026-07-01", endDate: "2026-07-03" }, "u1");
    const list = await svc.listByEquipment(eqId);
    expect(list).toHaveLength(1);
  });

  it("create: equipmentId/sensorId 둘 다 없으면 throw", async () => {
    await expect(svc.create({ title: "x", startDate: "2026-07-01", endDate: "2026-07-02" }, "u1"))
      .rejects.toThrow(/필수/);
  });

  it("create: 날짜 겹치면 충돌 throw(cross read)", async () => {
    const eqId = await makeEquipment();
    await svc.create({ equipmentId: eqId, title: "선점", startDate: "2026-07-01", endDate: "2026-07-05" }, "u1");
    await expect(svc.create({ equipmentId: eqId, title: "겹침", startDate: "2026-07-03", endDate: "2026-07-07" }, "u1"))
      .rejects.toThrow(/충돌/);
  });

  it("update + remove", async () => {
    const eqId = await makeEquipment();
    const s = await svc.create({ equipmentId: eqId, title: "원본", startDate: "2026-08-01", endDate: "2026-08-02" }, "u1");
    const updated = await svc.update(s.id, { title: "수정" });
    expect(updated.title).toBe("수정");
    await svc.remove(s.id);
    expect(await svc.listByEquipment(eqId)).toHaveLength(0);
  });
});
