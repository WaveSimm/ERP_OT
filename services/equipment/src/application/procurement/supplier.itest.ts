import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { SupplierService } from "./supplier.service";
import { PrismaSupplierRepository } from "../../infrastructure/repositories/supplier.repository";

// supplier 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   Supplier aggregate(+contacts) CRUD + findByName + 미존재 가드를 실제 prisma로 검증.

const svc = new SupplierService(new PrismaSupplierRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

describe("supplier.service (integration)", () => {
  it("create + getById + findByName(대소문자 무시)", async () => {
    const s = await svc.create({ name: "Acme Corp", country: "USA" });
    expect(s.id).toBeTruthy();

    const found = await svc.getById(s.id);
    expect(found.name).toBe("Acme Corp");

    const byName = await svc.findByName("acme corp"); // case-insensitive
    expect(byName?.id).toBe(s.id);
  });

  it("getById: 없는 id는 throw", async () => {
    await expect(svc.getById("nope")).rejects.toThrow(/찾을 수 없습니다/);
  });

  it("update: 필드 변경 반영", async () => {
    const s = await svc.create({ name: "OldName" });
    const updated = await svc.update(s.id, { country: "JP", contactName: "tanaka" });
    expect(updated.country).toBe("JP");
    expect(updated.contactName).toBe("tanaka");
  });

  it("remove: 삭제 + 이후 조회 throw", async () => {
    const s = await svc.create({ name: "ToDelete" });
    await svc.remove(s.id);
    await expect(svc.getById(s.id)).rejects.toThrow(/찾을 수 없습니다/);
  });

  it("contacts: add/update/remove (aggregate 자식)", async () => {
    const s = await svc.create({ name: "WithContacts" });
    const c = await svc.addContact(s.id, { name: "김담당", phone: "010-1111" });
    expect(c.supplierId).toBe(s.id);

    const updated = await svc.updateContact(c.id, { phone: "010-2222" });
    expect(updated.phone).toBe("010-2222");

    await svc.removeContact(c.id);
    const remaining = await prisma.supplierContact.count({ where: { supplierId: s.id } });
    expect(remaining).toBe(0);
  });
});
