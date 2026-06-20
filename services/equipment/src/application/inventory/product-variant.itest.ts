import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { ProductVariantService } from "./product-variant.service";
import { PrismaProductVariantRepository } from "../../infrastructure/repositories/product-variant.repository";

// product-variant 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   CRUD(+master include) + SKU 자동생성 + (master,specs) 중복방지 + remove 가드.

const svc = new ProductVariantService(new PrismaProductVariantRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

async function makeMaster(): Promise<string> {
  const m = await prisma.productMaster.create({
    data: { name: `Master-${Math.round(performance.now())}`, manufacturer: "ACME", masterCode: "ACM" },
  });
  return m.id;
}

describe("product-variant.service (integration)", () => {
  it("create: SKU 자동생성(masterCode 기반) + master 포함 반환", async () => {
    const masterId = await makeMaster();
    const v = await svc.create({ productMasterId: masterId, variantSpecs: { size: "L" } });
    expect(v.productMaster.id).toBe(masterId);
    expect(v.skuCode).toMatch(/^ACM-/);
  });

  it("create: 동일 (master, specs) 중복은 throw", async () => {
    const masterId = await makeMaster();
    await svc.create({ productMasterId: masterId, variantSpecs: { size: "M" } });
    await expect(svc.create({ productMasterId: masterId, variantSpecs: { size: "M" } }))
      .rejects.toThrow(/이미 동일한 옵션/);
  });

  it("listByMaster + getById(totalStockQuantity)", async () => {
    const masterId = await makeMaster();
    await svc.create({ productMasterId: masterId, variantSpecs: { size: "S" } });
    const list = await svc.listByMaster(masterId);
    expect(list).toHaveLength(1);
    const detail = await svc.getById(list[0]!.id);
    expect(detail.totalStockQuantity).toBe(0);
  });

  it("update: isActive 변경", async () => {
    const masterId = await makeMaster();
    const v = await svc.create({ productMasterId: masterId, variantSpecs: { size: "XL" } });
    const updated = await svc.update(v.id, { isActive: false });
    expect(updated.isActive).toBe(false);
  });

  it("remove: 참조 없으면 삭제", async () => {
    const masterId = await makeMaster();
    const v = await svc.create({ productMasterId: masterId, variantSpecs: { color: "red" } });
    await svc.remove(v.id);
    await expect(svc.getById(v.id)).rejects.toThrow(/찾을 수 없습니다/);
  });
});
