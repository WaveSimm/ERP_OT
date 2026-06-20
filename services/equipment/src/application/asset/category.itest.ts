import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { CategoryService } from "./category.service";
import { PrismaCategoryRepository } from "../../infrastructure/repositories/category.repository";

// category 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   CRUD + 삭제 가드(사용 중 장비 존재 시 차단)를 실제 prisma·FK로 검증.

const svc = new CategoryService(new PrismaCategoryRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

describe("category.service (integration)", () => {
  it("create + list(type 필터) + sortOrder 정렬", async () => {
    await svc.create({ name: "측정장비", type: "EQUIPMENT", sortOrder: 2 });
    await svc.create({ name: "센서류", type: "SENSOR", sortOrder: 1 });
    await svc.create({ name: "계측기", type: "EQUIPMENT", sortOrder: 1 });

    const all = await svc.list();
    expect(all.length).toBe(3);

    const equip = await svc.list("EQUIPMENT");
    expect(equip.map((c) => c.name)).toEqual(["계측기", "측정장비"]); // sortOrder asc
  });

  it("update: 이름/정렬 변경 반영", async () => {
    const c = await svc.create({ name: "구명", type: "EQUIPMENT" });
    const updated = await svc.update(c.id, { name: "신명", sortOrder: 5 });
    expect(updated.name).toBe("신명");
    expect(updated.sortOrder).toBe(5);
  });

  it("remove: 미사용 카테고리는 삭제", async () => {
    const c = await svc.create({ name: "삭제대상", type: "EQUIPMENT" });
    await svc.remove(c.id);
    expect(await svc.list()).toHaveLength(0);
  });

  it("remove: 사용 중(장비 연결) 카테고리는 가드로 차단 + DB 잔존", async () => {
    const c = await svc.create({ name: "사용중", type: "EQUIPMENT" });
    await prisma.equipment.create({
      data: { categoryId: c.id, name: "장비A", serialNumber: "SN-CAT-1", createdBy: "test" },
    });

    await expect(svc.remove(c.id)).rejects.toThrow(/사용 중/);
    expect(await svc.list()).toHaveLength(1); // 미삭제 확인
  });
});
