import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { InventoryAuditService } from "./inventory-audit.service";
import { PrismaInventoryAuditRepository } from "../../infrastructure/repositories/inventory-audit.repository";

// inventory-audit 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   create(전체재고 스냅샷) + 항목 체크(불일치 판정) + 상태전이(start/pause/resume/complete) + 완료 가드.

const svc = new InventoryAuditService(new PrismaInventoryAuditRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

async function makeInventoryItem(qty: number): Promise<string> {
  const i = await prisma.inventoryItem.create({
    data: { inventoryNo: `INV-AUD-${Math.round(performance.now())}`, quantity: qty, currentStatus: "IN_STOCK", createdBy: "t" },
  });
  return i.id;
}

describe("inventory-audit.service (integration)", () => {
  it("create: 전체재고 스냅샷 자동 포함", async () => {
    await makeInventoryItem(10);
    await makeInventoryItem(5);
    const audit = await svc.create({ name: "2026 1차", plannedDate: "2026-07-01", createdBy: "u1" });
    expect(audit._count.items).toBe(2);
  });

  it("checkItem: 수량 일치/불일치/누락 판정", async () => {
    await makeInventoryItem(10);
    const audit = await svc.create({ name: "감사", plannedDate: "2026-07-01", createdBy: "u1" });
    const detail = await svc.getById(audit.id);
    const itemId = detail.items[0]!.id;

    const mismatched = await svc.checkItem(itemId, { actualQuantity: 8, checkedBy: "u1" });
    expect(mismatched.status).toBe("MISMATCHED");
    const reset = await svc.resetItem(itemId);
    expect(reset.status).toBe("PENDING");
    const matched = await svc.checkItem(itemId, { actualQuantity: 10, checkedBy: "u1" });
    expect(matched.status).toBe("MATCHED");
  });

  it("상태전이: start→pause→resume + 완료가드(미확인 존재 시 throw)", async () => {
    await makeInventoryItem(10);
    const audit = await svc.create({ name: "감사", plannedDate: "2026-07-01", createdBy: "u1" });
    await svc.start(audit.id);
    const paused = await svc.pause(audit.id);
    expect(paused.status).toBe("PAUSED");
    await svc.resume(audit.id);
    // 미확인 항목 남아있어 완료 불가
    await expect(svc.complete(audit.id)).rejects.toThrow(/미확인 항목/);
  });

  it("complete: 모든 항목 확인 후 완료", async () => {
    await makeInventoryItem(10);
    const audit = await svc.create({ name: "감사", plannedDate: "2026-07-01", createdBy: "u1" });
    await svc.start(audit.id);
    const detail = await svc.getById(audit.id);
    await svc.checkItem(detail.items[0]!.id, { actualQuantity: 10, checkedBy: "u1" });
    const done = await svc.complete(audit.id);
    expect(done.status).toBe("COMPLETED");
    expect(done.completedAt).not.toBeNull();
  });

  it("pause: 진행중 아니면 throw", async () => {
    await makeInventoryItem(1);
    const audit = await svc.create({ name: "감사", plannedDate: "2026-07-01", createdBy: "u1" });
    await expect(svc.pause(audit.id)).rejects.toThrow(/진행중인 실사만/);
  });
});
