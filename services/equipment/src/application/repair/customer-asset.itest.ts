import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { CustomerAssetService } from "./customer-asset.service";
import { PrismaCustomerAssetRepository } from "../../infrastructure/repositories/customer-asset.repository";

// customer-asset 통합테스트 — repository 전환 회귀 안전망(실 DB). CRUD + 삭제 가드(AS 이력).

const svc = new CustomerAssetService(new PrismaCustomerAssetRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

async function makeCustomer(): Promise<string> {
  const c = await prisma.customer.create({ data: { name: `고객-${Math.round(performance.now())}` } });
  return c.id;
}

describe("customer-asset.service (integration)", () => {
  it("create + getById(cross include) + list 필터", async () => {
    const customerId = await makeCustomer();
    const a = await svc.create({ customerId, assetType: "PUMP", name: "펌프1", serialNumber: "SN-1" });
    expect(a.id).toBeTruthy();

    const found = await svc.getById(a.id);
    expect(found.customer.id).toBe(customerId);
    expect(found.repairOrders).toEqual([]);

    const list = await svc.list({ customerId });
    expect(list.total).toBe(1);
  });

  it("getById: 없는 id throw", async () => {
    await expect(svc.getById("nope")).rejects.toThrow(/찾을 수 없습니다/);
  });

  it("update: 날짜 필드(soldAt) 포함 변경", async () => {
    const customerId = await makeCustomer();
    const a = await svc.create({ customerId, assetType: "PUMP", name: "원본" });
    const updated = await svc.update(a.id, { name: "수정", soldAt: "2026-01-15" });
    expect(updated.name).toBe("수정");
    expect(updated.soldAt).not.toBeNull();
  });

  it("remove: AS 이력 없으면 삭제 / 있으면 가드 throw", async () => {
    const customerId = await makeCustomer();
    const free = await svc.create({ customerId, assetType: "PUMP", name: "삭제품" });
    await svc.remove(free.id);
    await expect(svc.getById(free.id)).rejects.toThrow(/찾을 수 없습니다/);

    const used = await svc.create({ customerId, assetType: "PUMP", name: "이력품" });
    await prisma.repairOrder.create({
      data: { orderNumber: `AS-CA-${Date.now()}`, symptom: "x", customerAssetId: used.id },
    });
    await expect(svc.remove(used.id)).rejects.toThrow(/AS 이력/);
  });
});
