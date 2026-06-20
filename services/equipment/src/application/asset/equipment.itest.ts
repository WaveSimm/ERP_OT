import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { EquipmentService } from "./equipment.service";
import { PrismaEquipmentRepository } from "../../infrastructure/repositories/equipment.repository";

// equipment 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   CRUD(+category include) + 상태전이 FSM + 구성요소(component) 자식 CRUD.

const svc = new EquipmentService(new PrismaEquipmentRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

async function makeCategory(): Promise<string> {
  const c = await prisma.category.create({ data: { name: `cat-${Math.round(performance.now())}`, type: "EQUIPMENT" } });
  return c.id;
}

describe("equipment.service (integration)", () => {
  it("create(category 포함 반환) + getById(다중 include)", async () => {
    const categoryId = await makeCategory();
    const e = await svc.create({ categoryId, name: "장비1", serialNumber: "SN-EQ-1" }, "u1");
    expect(e.category.id).toBe(categoryId); // create가 category 포함 반환

    const found = await svc.getById(e.id);
    expect(found.components).toEqual([]);
    expect(found.sensorCompatibility).toEqual([]);
  });

  it("changeStatus: 허용 전이 + 금지 전이 throw", async () => {
    const categoryId = await makeCategory();
    const e = await svc.create({ categoryId, name: "장비", serialNumber: "SN-EQ-2" }, "u1");
    // 기본 status AVAILABLE → IN_OPERATION 허용
    const moved = await svc.changeStatus(e.id, "IN_OPERATION");
    expect(moved.status).toBe("IN_OPERATION");
    // RETIRED로 만든 뒤 추가 전이는 금지
    await svc.changeStatus(e.id, "RETIRED");
    await expect(svc.changeStatus(e.id, "AVAILABLE")).rejects.toThrow(/허용되지 않습니다/);
  });

  it("remove: status RETIRED 처리(soft)", async () => {
    const categoryId = await makeCategory();
    const e = await svc.create({ categoryId, name: "폐기품", serialNumber: "SN-EQ-3" }, "u1");
    const retired = await svc.remove(e.id);
    expect(retired.status).toBe("RETIRED");
  });

  it("components: add/list/update/remove (자식)", async () => {
    const categoryId = await makeCategory();
    const e = await svc.create({ categoryId, name: "장비", serialNumber: "SN-EQ-4" }, "u1");
    const comp = await svc.addComponent(e.id, { name: "모터", spec: "5kW" });
    expect((await svc.listComponents(e.id))).toHaveLength(1);
    const updated = await svc.updateComponent(comp.id, { spec: "7kW" });
    expect(updated.spec).toBe("7kW");
    await svc.removeComponent(comp.id);
    expect(await svc.listComponents(e.id)).toHaveLength(0);
  });
});
