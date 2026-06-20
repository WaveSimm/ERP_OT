import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { PartService } from "./part.service";
import { PrismaPartRepository } from "../../infrastructure/repositories/part.repository";

// part 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   CRUD + 삭제 가드(입출고 이력) + 재고 트랜잭션(IN/OUT/ADJUST·부족 차단)을 실제 prisma로 검증.

const svc = new PartService(new PrismaPartRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

describe("part.service (integration)", () => {
  it("create + getById", async () => {
    const p = await svc.create({ partNumber: "PN-001", name: "베어링", stockQuantity: 10 });
    expect(p.id).toBeTruthy();
    const found = await svc.getById(p.id);
    expect(found.name).toBe("베어링");
    expect(found.stockQuantity).toBe(10);
  });

  it("update: 필드 변경 반영", async () => {
    const p = await svc.create({ partNumber: "PN-002", name: "구품" });
    const updated = await svc.update(p.id, { name: "신품", minStockLevel: 5 });
    expect(updated.name).toBe("신품");
    expect(updated.minStockLevel).toBe(5);
  });

  it("createTransaction: IN/OUT 재고 반영", async () => {
    const p = await svc.create({ partNumber: "PN-003", name: "재고품", stockQuantity: 10 });
    await svc.createTransaction({ partId: p.id, type: "IN", quantity: 5 });
    expect((await svc.getById(p.id)).stockQuantity).toBe(15);
    await svc.createTransaction({ partId: p.id, type: "OUT", quantity: 3 });
    expect((await svc.getById(p.id)).stockQuantity).toBe(12);
  });

  it("createTransaction: ADJUST는 직접 설정", async () => {
    const p = await svc.create({ partNumber: "PN-004", name: "조정품", stockQuantity: 10 });
    await svc.createTransaction({ partId: p.id, type: "ADJUST", quantity: 99 });
    expect((await svc.getById(p.id)).stockQuantity).toBe(99);
  });

  it("createTransaction: 재고 부족 OUT은 throw + 변화 없음", async () => {
    const p = await svc.create({ partNumber: "PN-005", name: "부족품", stockQuantity: 2 });
    await expect(svc.createTransaction({ partId: p.id, type: "OUT", quantity: 5 }))
      .rejects.toThrow(/재고가 부족/);
    expect((await svc.getById(p.id)).stockQuantity).toBe(2); // 미변경(롤백)
  });

  it("remove: 입출고 이력 있으면 가드 차단, 없으면 삭제", async () => {
    const used = await svc.create({ partNumber: "PN-006", name: "이력품", stockQuantity: 5 });
    await svc.createTransaction({ partId: used.id, type: "IN", quantity: 1 });
    await expect(svc.remove(used.id)).rejects.toThrow(/이력/);

    const free = await svc.create({ partNumber: "PN-007", name: "삭제품" });
    await svc.remove(free.id);
    await expect(svc.getById(free.id)).rejects.toThrow(/찾을 수 없습니다/);
  });
});
