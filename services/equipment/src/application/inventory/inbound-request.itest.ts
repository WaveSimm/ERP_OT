import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { InboundRequestService } from "./inbound-request.service";
import { InventoryService } from "./inventory.service";
import { PrismaInboundRequestRepository } from "../../infrastructure/repositories/inbound-request.repository";

// inbound-request 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   create(items nested·코드 자동발급) + cancel(가드) + createFromOverseasOrder(미입고 계산·reuse).
//   receive($transaction 사가)는 inventoryService 의존이라 범위 외.

const svc = new InboundRequestService(
  new PrismaInboundRequestRepository(prisma),
  prisma,
  new InventoryService(prisma),
);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

describe("inbound-request.service (integration)", () => {
  it("create: 코드(IR-) 자동발급 + items nested + getById", async () => {
    const r = await svc.create({
      sourceType: "MANUAL",
      requesterId: "u1",
      items: [{ quantity: 3, itemNameRaw: "부품A" }],
    });
    expect(r.code).toMatch(/^IR-/);
    expect(r.status).toBe("PENDING");
    expect(r.items).toHaveLength(1);

    const found = await svc.getById(r.id);
    expect(found.items).toHaveLength(1);
  });

  it("create: 품목 0개면 throw", async () => {
    await expect(svc.create({ sourceType: "MANUAL", requesterId: "u1", items: [] }))
      .rejects.toThrow(/최소 1개 품목/);
  });

  it("cancel: PENDING→CANCELED + PENDING 아니면 가드", async () => {
    const r = await svc.create({ sourceType: "MANUAL", requesterId: "u1", items: [{ quantity: 1, itemNameRaw: "x" }] });
    const canceled = await svc.cancel(r.id, "단순 취소");
    expect(canceled.status).toBe("CANCELED");
    await expect(svc.cancel(r.id)).rejects.toThrow(/PENDING 상태에서만/);
  });

  it("createFromOverseasOrder: 미입고 품목으로 생성 + 재호출 시 기존 PENDING reuse", async () => {
    const contract = await prisma.contract.create({ data: { contractNumber: `CT-IR-${Date.now()}`, name: "c", client: "c" } });
    const order = await prisma.overseasOrder.create({
      data: {
        orderNumber: `OO-IR-${Date.now()}`, manufacturer: "M", contractId: contract.id,
        currency: "USD", orderedBy: "t", totalAmount: 100,
        items: { create: [{ name: "품목A", quantity: 5, unitPrice: 20, amount: 100 }] },
      },
    });

    const first = await svc.createFromOverseasOrder(order.id, "u1");
    expect(first.items).toHaveLength(1);
    expect(first.items[0]!.quantity).toBe(5);

    const second = await svc.createFromOverseasOrder(order.id, "u1");
    expect(second.id).toBe(first.id); // reuse
  });
});
