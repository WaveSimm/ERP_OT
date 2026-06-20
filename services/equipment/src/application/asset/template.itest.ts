import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { TemplateService } from "./template.service";
import { PrismaDeploymentTemplateRepository } from "../../infrastructure/repositories/deployment-template.repository";

// deployment-template 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   CRUD + list 필터(isPublic/createdBy) + sensorConfig(Json) 영속화를 실제 prisma로 검증.

const svc = new TemplateService(new PrismaDeploymentTemplateRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

describe("template.service (integration)", () => {
  it("create: sensorConfig(Json) + createdBy 영속화", async () => {
    const t = await svc.create(
      { name: "표준구성", sensorConfig: [{ sensorCategoryId: "c1", configParams: { hz: 10 } }], isPublic: true },
      "user-1",
    );
    expect(t.id).toBeTruthy();
    expect(t.createdBy).toBe("user-1");
    expect(t.isPublic).toBe(true);

    const found = await svc.getById(t.id);
    expect(Array.isArray(found.sensorConfig)).toBe(true);
  });

  it("getById: 없는 id는 throw", async () => {
    await expect(svc.getById("nope")).rejects.toThrow(/찾을 수 없습니다/);
  });

  it("list: isPublic / createdBy 필터", async () => {
    await svc.create({ name: "공개", sensorConfig: [], isPublic: true }, "u1");
    await svc.create({ name: "비공개", sensorConfig: [], isPublic: false }, "u2");

    const pub = await svc.list({ isPublic: true });
    expect(pub.map((t) => t.name)).toEqual(["공개"]);

    const byU2 = await svc.list({ createdBy: "u2" });
    expect(byU2.map((t) => t.name)).toEqual(["비공개"]);
  });

  it("update: 이름/공개여부 변경", async () => {
    const t = await svc.create({ name: "구명", sensorConfig: [] }, "u1");
    const updated = await svc.update(t.id, { name: "신명", isPublic: true });
    expect(updated.name).toBe("신명");
    expect(updated.isPublic).toBe(true);
  });

  it("remove: 삭제 후 조회 throw", async () => {
    const t = await svc.create({ name: "삭제대상", sensorConfig: [] }, "u1");
    await svc.remove(t.id);
    await expect(svc.getById(t.id)).rejects.toThrow(/찾을 수 없습니다/);
  });
});
