import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { ContractService } from "./contract.service";
import { PrismaContractRepository } from "../../infrastructure/repositories/contract.repository";

// contract 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   CRUD + 계약번호 자동생성 + finalize(PROSPECTIVE→ACTIVE) + remove 가드.

const svc = new ContractService(new PrismaContractRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

describe("contract.service (integration)", () => {
  it("create: PROSPECTIVE면 TEMP- 번호 자동생성", async () => {
    const c = await svc.create({ name: "신규계약", client: "고객사" });
    expect(c.status).toBe("PROSPECTIVE");
    expect(c.contractNumber).toMatch(/^TEMP-/);
  });

  it("getById: 없는 id throw, 있으면 orders 포함", async () => {
    await expect(svc.getById("nope")).rejects.toThrow(/찾을 수 없습니다/);
    const c = await svc.create({ name: "계약", client: "C" });
    const found = await svc.getById(c.id);
    expect(found.orders).toEqual([]);
  });

  it("finalize: PROSPECTIVE→ACTIVE, 정식번호 + TEMP- 거부", async () => {
    const c = await svc.create({ name: "확정대상", client: "C" });
    await expect(svc.finalize(c.id, { contractNumber: "TEMP-9999-001" })).rejects.toThrow(/정식 계약번호/);
    const finalized = await svc.finalize(c.id, { contractNumber: "#26-01" });
    expect(finalized.status).toBe("ACTIVE");
    expect(finalized.contractNumber).toBe("#26-01");
  });

  it("update: 필드 변경", async () => {
    const c = await svc.create({ name: "원본", client: "C" });
    const updated = await svc.update(c.id, { manager: "홍길동", category: "장비" });
    expect(updated.manager).toBe("홍길동");
  });

  it("remove: 발주 없으면 삭제 / 있으면 가드 throw", async () => {
    const c = await svc.create({ name: "삭제대상", client: "C" });
    await svc.remove(c.id);
    await expect(svc.getById(c.id)).rejects.toThrow(/찾을 수 없습니다/);

    const withOrder = await svc.create({ name: "발주있음", client: "C" });
    await prisma.overseasOrder.create({
      data: { orderNumber: `OO-CT-${Date.now()}`, manufacturer: "M", contractId: withOrder.id, currency: "USD", orderedBy: "t", totalAmount: 100 },
    });
    await expect(svc.remove(withOrder.id)).rejects.toThrow(/발주/);
  });
});
