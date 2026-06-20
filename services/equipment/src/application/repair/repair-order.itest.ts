import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { RepairOrderService } from "./repair-order.service";

// repair-order 통합테스트(파일럿) — 실 DB로 create→changeStatus 흐름 검증.
//   목적: 향후 application→infra(repository) 계층 전환 시 회귀 안전망.
//   단위 FSM 테스트(repair-order.fsm.test.ts)와 달리 실제 prisma 동작·DB 상태를 확인.

const svc = new RepairOrderService(prisma);

beforeAll(async () => {
  await truncateAll();
});
afterEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await disconnect();
});

describe("repair-order.service (integration)", () => {
  it("create: orderNumber 자동생성 + 기본 status=RECEIVED + DB 영속화", async () => {
    const created = await svc.create({ symptom: "전원 안 켜짐" });

    expect(created.id).toBeTruthy();
    expect(created.orderNumber).toMatch(/^AS-\d{4}-\d+$/);
    expect(created.status).toBe("RECEIVED");

    const inDb = await prisma.repairOrder.findUnique({ where: { id: created.id } });
    expect(inDb?.symptom).toBe("전원 안 켜짐");
  });

  it("changeStatus: 허용 전환(RECEIVED→INSPECTING_1ST) 반영", async () => {
    const order = await svc.create({ symptom: "점검 요청" });
    const updated = await svc.changeStatus(order.id, "INSPECTING_1ST");

    expect(updated.status).toBe("INSPECTING_1ST");
    const inDb = await prisma.repairOrder.findUnique({ where: { id: order.id } });
    expect(inDb?.status).toBe("INSPECTING_1ST");
  });

  it("changeStatus: 금지 전환(RECEIVED→COMPLETED)은 throw + DB 불변", async () => {
    const order = await svc.create({ symptom: "잘못된 전환" });
    await expect(svc.changeStatus(order.id, "COMPLETED")).rejects.toThrow(/허용되지 않습니다|전이/);

    const inDb = await prisma.repairOrder.findUnique({ where: { id: order.id } });
    expect(inDb?.status).toBe("RECEIVED"); // 롤백/미변경 확인
  });

  it("getStatusTransitions: 현재 상태의 허용 전환 목록 반환", async () => {
    const order = await svc.create({ symptom: "전환 목록" });
    const res = await svc.getStatusTransitions(order.id);

    expect(res.currentStatus).toBe("RECEIVED");
    expect(res.allowedTransitions).toContain("INSPECTING_1ST");
    expect(res.allowedTransitions).toContain("CANCELLED");
  });
});
