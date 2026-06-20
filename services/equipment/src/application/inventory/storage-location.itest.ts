import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { StorageLocationService } from "./storage-location.service";
import { PrismaStorageLocationRepository } from "../../infrastructure/repositories/storage-location.repository";

// storage-location 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   CRUD + list 필터 + 삭제 가드(사용 중 재고 존재 시 차단)를 실제 prisma·FK로 검증.

const svc = new StorageLocationService(new PrismaStorageLocationRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

describe("storage-location.service (integration)", () => {
  it("create + getById", async () => {
    const loc = await svc.create({ name: "본사창고", type: "WAREHOUSE" });
    expect(loc.id).toBeTruthy();
    expect(loc.isActive).toBe(true);

    const found = await svc.getById(loc.id);
    expect(found.name).toBe("본사창고");
  });

  it("getById: 없는 id는 throw", async () => {
    await expect(svc.getById("no-such-id")).rejects.toThrow(/찾을 수 없습니다/);
  });

  it("update: 이름/비활성화 반영", async () => {
    const loc = await svc.create({ name: "구창고", type: "WAREHOUSE" });
    const updated = await svc.update(loc.id, { name: "신창고", isActive: false });
    expect(updated.name).toBe("신창고");
    expect(updated.isActive).toBe(false);
  });

  it("list: 기본은 활성만, includeInactive로 전체", async () => {
    const a = await svc.create({ name: "활성창고", type: "WAREHOUSE" });
    const b = await svc.create({ name: "비활성창고", type: "WAREHOUSE" });
    await svc.update(b.id, { isActive: false });

    const activeOnly = await svc.list();
    expect(activeOnly.items.map((l) => l.name)).toContain("활성창고");
    expect(activeOnly.items.map((l) => l.name)).not.toContain("비활성창고");

    const all = await svc.list({ includeInactive: true });
    expect(all.total).toBe(2);
    void a;
  });

  it("remove: 사용 중(재고 connected) 위치는 가드로 차단 + DB 잔존", async () => {
    const loc = await svc.create({ name: "재고있는창고", type: "WAREHOUSE" });
    await prisma.inventoryItem.create({
      data: { inventoryNo: "INV-LOC-1", currentLocation: loc.name, createdBy: "test" },
    });

    await expect(svc.remove(loc.id)).rejects.toThrow(/재고/);
    expect(await svc.getById(loc.id)).toBeTruthy(); // 미삭제 확인
  });

  it("remove: 미사용 위치는 삭제", async () => {
    const loc = await svc.create({ name: "빈창고", type: "WAREHOUSE" });
    await svc.remove(loc.id);
    await expect(svc.getById(loc.id)).rejects.toThrow(/찾을 수 없습니다/);
  });
});
