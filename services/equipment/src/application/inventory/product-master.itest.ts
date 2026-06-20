import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { ProductMasterService } from "./product-master.service";
import { PrismaProductMasterRepository } from "../../infrastructure/repositories/product-master.repository";

// product-master 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   CRUD + getById(include) + remove 가드(발주 품목) + getManufacturers(distinct).

const svc = new ProductMasterService(new PrismaProductMasterRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

describe("product-master.service (integration)", () => {
  it("create + getById(include)", async () => {
    const pm = await svc.create({ name: "펌프마스터", manufacturer: "ACME", referencePrice: 1000 });
    expect(pm.id).toBeTruthy();
    const found = await svc.getById(pm.id);
    expect(found.name).toBe("펌프마스터");
    expect(found.variants).toEqual([]);
  });

  it("getById: 없는 id throw", async () => {
    await expect(svc.getById("nope")).rejects.toThrow(/찾을 수 없습니다/);
  });

  it("update + getManufacturers(distinct)", async () => {
    const pm = await svc.create({ name: "마스터", manufacturer: "M1" });
    const updated = await svc.update(pm.id, { manufacturer: "M2" });
    expect(updated.manufacturer).toBe("M2");
    const mans = await svc.getManufacturers();
    expect(mans).toContain("M2");
  });

  it("list: 검색 + stockSummary 포함", async () => {
    await svc.create({ name: "검색대상", manufacturer: "ACME" });
    const res = await svc.list({ search: "검색대상" });
    expect(res.total).toBe(1);
    expect(res.items[0]!.stockSummary).toEqual({ items: 0, quantity: 0 });
  });

  it("remove: 발주 품목 없으면 삭제 / 있으면 가드 throw", async () => {
    const pm = await svc.create({ name: "삭제대상", manufacturer: "M" });
    await svc.remove(pm.id);
    await expect(svc.getById(pm.id)).rejects.toThrow(/찾을 수 없습니다/);

    const withOrder = await svc.create({ name: "발주있음", manufacturer: "M" });
    const contract = await prisma.contract.create({ data: { contractNumber: `CT-PM-${Date.now()}`, name: "c", client: "c" } });
    const order = await prisma.overseasOrder.create({
      data: { orderNumber: `OO-PM-${Date.now()}`, manufacturer: "M", contractId: contract.id, currency: "USD", orderedBy: "t", totalAmount: 1 },
    });
    await prisma.overseasOrderItem.create({
      data: { orderId: order.id, productMasterId: withOrder.id, name: "품목", quantity: 1, unitPrice: 1, amount: 1 },
    });
    await expect(svc.remove(withOrder.id)).rejects.toThrow(/발주 품목/);
  });
});
