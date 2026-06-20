import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma, truncateAll, disconnect } from "../../test-integration/helper";
import { CustomerService } from "./customer.service";
import { PrismaCustomerRepository } from "../../infrastructure/repositories/customer.repository";

// customer 통합테스트 — repository 전환 회귀 안전망(실 DB).
//   CRUD + 담당자(contacts) 자식 CRUD + 주담당자 단일성 + remove 가드/자식 정리.

const svc = new CustomerService(new PrismaCustomerRepository(prisma), prisma);

beforeAll(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await disconnect(); });

describe("customer.service (integration)", () => {
  it("create + getById(include) + list", async () => {
    const c = await svc.create({ name: "고객사A", phone: "02-111" });
    expect(c.id).toBeTruthy();
    const found = await svc.getById(c.id);
    expect(found.name).toBe("고객사A");
    expect(found.contacts).toEqual([]);
    const list = await svc.list({ search: "고객사A" });
    expect(list.total).toBe(1);
  });

  it("update", async () => {
    const c = await svc.create({ name: "원본" });
    const updated = await svc.update(c.id, { contactPerson: "김대표" });
    expect(updated.contactPerson).toBe("김대표");
  });

  it("contacts: 주담당자 단일성(새 주담당자 지정 시 기존 해제)", async () => {
    const c = await svc.create({ name: "고객" });
    const c1 = await svc.createContact(c.id, { name: "담당1", isPrimary: true });
    const c2 = await svc.createContact(c.id, { name: "담당2", isPrimary: true });
    const contacts = await svc.listContacts(c.id);
    const primary = contacts.filter((x) => x.isPrimary);
    expect(primary).toHaveLength(1);
    expect(primary[0]!.id).toBe(c2.id);
    void c1;
  });

  it("contact update/remove", async () => {
    const c = await svc.create({ name: "고객" });
    const ct = await svc.createContact(c.id, { name: "담당" });
    const updated = await svc.updateContact(ct.id, { phone: "010-9999" });
    expect(updated.phone).toBe("010-9999");
    await svc.removeContact(ct.id);
    expect(await svc.listContacts(c.id)).toHaveLength(0);
  });

  it("remove: AS 이력 가드 + 자식(assets/contacts) 정리", async () => {
    const c = await svc.create({ name: "삭제대상" });
    await svc.createContact(c.id, { name: "담당" });
    await prisma.customerAsset.create({ data: { customerId: c.id, assetType: "PUMP", name: "자산" } });
    await svc.remove(c.id);
    await expect(svc.getById(c.id)).rejects.toThrow(/찾을 수 없습니다/);
    expect(await prisma.customerContact.count({ where: { customerId: c.id } })).toBe(0);

    const used = await svc.create({ name: "이력있음" });
    await prisma.repairOrder.create({ data: { orderNumber: `AS-CU-${Date.now()}`, symptom: "x", customerId: used.id } });
    await expect(svc.remove(used.id)).rejects.toThrow(/AS 이력/);
  });
});
