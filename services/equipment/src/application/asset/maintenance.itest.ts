import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { MaintenanceService } from "./maintenance.service";
import { PrismaMaintenanceRecordRepository } from "../../infrastructure/repositories/maintenance-record.repository";

// maintenance 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   CRUD + 교정(CALIBRATION) 완료 시 sensor 교정일 갱신(cross-aggregate) 검증.

const svc = new MaintenanceService(new PrismaMaintenanceRecordRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

async function makeEquipment(): Promise<string> {
  const cat = await prisma.category.create({ data: { name: `cat-${Math.round(performance.now())}`, type: "EQUIPMENT" } });
  const e = await prisma.equipment.create({ data: { name: "장비", serialNumber: `SN-MNT-${Date.now()}`, createdBy: "t", categoryId: cat.id } });
  return e.id;
}

describe("maintenance.service (integration)", () => {
  it("create + listByEquipment", async () => {
    const eqId = await makeEquipment();
    await svc.create({ equipmentId: eqId, type: "CORRECTIVE", title: "수리1", performedAt: "2026-06-01" }, "u1");
    const list = await svc.listByEquipment(eqId);
    expect(list.total).toBe(1);
    expect(list.items[0]!.title).toBe("수리1");
  });

  it("create: equipmentId/sensorId 둘 다 없으면 throw", async () => {
    await expect(svc.create({ type: "CORRECTIVE", title: "x", performedAt: "2026-06-01" }, "u1"))
      .rejects.toThrow(/필수/);
  });

  it("create CALIBRATION 완료 → sensor 교정일 자동 갱신(cross-aggregate)", async () => {
    const cat = await prisma.category.create({ data: { name: `cat-cal-${Math.round(performance.now())}`, type: "SENSOR" } });
    const sensor = await prisma.sensor.create({
      data: { name: "교정센서", serialNumber: `SS-CAL-${Date.now()}`, createdBy: "t", calibrationIntervalDays: 30, categoryId: cat.id },
    });
    await svc.create({
      sensorId: sensor.id, type: "CALIBRATION", title: "교정",
      performedAt: "2026-06-01", completedAt: "2026-06-01",
    }, "u1");

    const after = await prisma.sensor.findUnique({ where: { id: sensor.id } });
    expect(after?.lastCalibratedAt).not.toBeNull();
    expect(after?.nextCalibrationDue).not.toBeNull(); // +30일
  });

  it("update + remove", async () => {
    const eqId = await makeEquipment();
    const r = await svc.create({ equipmentId: eqId, type: "CORRECTIVE", title: "원본", performedAt: "2026-06-01" }, "u1");
    const updated = await svc.update(r.id, { title: "수정" });
    expect(updated.title).toBe("수정");
    await svc.remove(r.id);
    expect((await svc.listByEquipment(eqId)).total).toBe(0);
  });
});
