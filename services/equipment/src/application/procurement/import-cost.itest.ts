import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { ImportCostService } from "./import-cost.service";
import { PrismaImportCostSettlementRepository } from "../../infrastructure/repositories/import-cost-settlement.repository";

// import-cost 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   create(자식 nested) + remittance 추가/삭제 + addExtra($transaction: totalExtraCost 재계산) + remove.

const svc = new ImportCostService(new PrismaImportCostSettlementRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

function baseData() {
  return {
    declarationNo: `DEC-${Math.round(performance.now())}`,
    supplier: "ACME",
    declarationDate: "2026-06-01",
    totalImportCost: 10000,
    supplyAmount: 9000,
    vat: 900,
    createdBy: "u1",
  };
}

describe("import-cost.service (integration)", () => {
  it("create(remittances nested) + getById", async () => {
    const s = await svc.create({
      ...baseData(),
      remittances: [{ remittanceDate: "2026-06-02", foreignAmount: 100, exchangeRate: 1300, krwAmount: 130000 }],
    });
    expect(s.id).toBeTruthy();
    expect(s.remittances).toHaveLength(1);

    const found = await svc.getById(s.id);
    expect(found.declarationNo).toBe(s.declarationNo);
  });

  it("remittance: 추가/삭제 + 없는 정산 가드", async () => {
    const s = await svc.create(baseData());
    const r = await svc.addRemittance(s.id, { remittanceDate: "2026-06-03", foreignAmount: 50, exchangeRate: 1300, krwAmount: 65000 });
    expect(r.settlementId).toBe(s.id);
    await svc.removeRemittance(r.id);
    expect(await prisma.costRemittance.count({ where: { settlementId: s.id } })).toBe(0);

    await expect(svc.addRemittance("nope", { remittanceDate: "2026-06-03", foreignAmount: 1, exchangeRate: 1, krwAmount: 1 }))
      .rejects.toThrow(/원가정산을 찾을 수 없습니다/);
  });

  it("addExtra($transaction): totalExtraCost 재계산", async () => {
    const s = await svc.create(baseData());
    await svc.addExtra(s.id, { name: "통관수수료", amount: 300 });
    await svc.addExtra(s.id, { name: "보관료", amount: 200 });
    const after = await svc.getById(s.id);
    expect(Number(after.totalExtraCost)).toBe(500);
  });

  it("updateContract + remove", async () => {
    const contract = await prisma.contract.create({ data: { contractNumber: `CT-IC-${Date.now()}`, name: "c", client: "c" } });
    const s = await svc.create(baseData());
    const linked = await svc.updateContract(s.id, contract.id);
    expect(linked.contract?.contractNumber).toBe(contract.contractNumber);

    await svc.remove(s.id);
    await expect(svc.getById(s.id)).rejects.toThrow(/찾을 수 없습니다/);
  });
});
