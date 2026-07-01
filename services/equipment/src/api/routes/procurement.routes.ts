import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

// ─── Internal API (결재 콜백) ───────────────────────────────────────────

export async function internalOrderRoutes(fastify: FastifyInstance) {
  // 결재 승인 → 발주 확정 (approval-service에서 ORDER_CONFIRM 콜백)
  fastify.post("/internal/orders/:id/confirm", async (request, reply) => {
    const token = request.headers["x-internal-token"];
    if (token !== process.env.INTERNAL_API_TOKEN) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { id } = request.params as any;
    const order = await fastify.prisma.overseasOrder.findUnique({ where: { id } });
    if (!order) return reply.status(404).send({ error: "발주를 찾을 수 없습니다." });

    // PENDING_APPROVAL → ORDERED (결재 승인으로 바로 발주확정)
    // v1.6.1 (2026-05-15): 승인일·발주일 자동 기록 (APPROVED 단계 생략하지만 결재 완료 시점 = 승인일)
    const now = new Date();
    const result = await fastify.prisma.overseasOrder.update({
      where: { id },
      data: {
        status: "ORDERED",
        ...(!order.approvedAt && { approvedAt: now }),
        ...(!order.orderDate && { orderDate: now }),
      },
    });
    return result;
  });

  // 결재 반려 → 발주 반려
  fastify.post("/internal/orders/:id/reject", async (request, reply) => {
    const token = request.headers["x-internal-token"];
    if (token !== process.env.INTERNAL_API_TOKEN) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { id } = request.params as any;
    const result = await fastify.prisma.overseasOrder.update({
      where: { id },
      data: { status: "REJECTED" },
    });
    return result;
  });

  // GET /internal/contracts — 외부 사내서비스(photo-album)용 경량 계약 목록
  // 인증: 글로벌 requireInternal(X-Internal-Token). id/contractNumber/name/status 만 반환.
  fastify.get("/internal/contracts", async (request) => {
    const q = request.query as any;
    const result = await fastify.contractService.list({
      search: q.search || undefined,
      status: q.status || undefined,
      page: 1,
      limit: q.limit ? Math.min(500, Number(q.limit)) : 300,
    });
    return {
      items: (result.items ?? []).map((c: any) => ({
        id: c.id,
        contractNumber: c.contractNumber,
        name: c.name,
        status: c.status,
      })),
      total: result.total,
    };
  });
}

export async function productMasterRoutes(fastify: FastifyInstance) {
  // 조회: 전체 허용
  //   v1.6 B안 (2026-05-13): itemType 필터 추가. 발주 line 등 검색은 기본적으로 SIMPLE만.
  //   includeBundle=true 또는 itemType=BUNDLE 로 명시적 호출 시 BUNDLE 노출
  fastify.get("/", async (request) => {
    const q = request.query as any;
    let itemType: any;
    if (q.itemType === "SIMPLE" || q.itemType === "BUNDLE") {
      itemType = q.itemType;
    } else if (q.includeBundle === "true") {
      itemType = undefined; // 전체
    } else {
      itemType = "SIMPLE"; // 기본: 단일 품목만 (발주 등 보호)
    }
    return fastify.productMasterService.list({
      search: q.search || undefined,
      name: q.name || undefined,
      manufacturer: q.manufacturer || undefined,
      itemType,
      page: q.page ? Number(q.page) : 1,
      limit: q.limit ? Number(q.limit) : 50,
      ...(q.sortBy && { sortBy: q.sortBy }),
      ...((q.sortOrder === "asc" || q.sortOrder === "desc") && { sortOrder: q.sortOrder }),
    });
  });

  fastify.get("/manufacturers", async () => {
    return fastify.productMasterService.getManufacturers();
  });

  fastify.get("/:id", async (request) => {
    return fastify.productMasterService.getById((request.params as any).id);
  });

  // 생성/수정: ADMIN, MANAGER
  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const result = await fastify.productMasterService.create(request.body as any);
    return reply.status(201).send(result);
  });

  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { id } = request.params as any;
    return fastify.productMasterService.update(id, request.body as any);
  });

  // 삭제: ADMIN만
  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.productMasterService.remove((request.params as any).id);
    return reply.status(204).send();
  });

  // v1.6 B안 (2026-05-13): 번들 마스터의 구성품 (BomItem) 관리
  fastify.get("/:id/bundle-items", async (request) => {
    return fastify.productMasterService.listBundleItems((request.params as any).id);
  });

  fastify.put("/:id/bundle-items", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { id } = request.params as any;
    const body = request.body as any;
    return fastify.productMasterService.replaceBundleItems(id, body.items ?? []);
  });

  // v1.6 B안 (2026-05-13): 번들 사전 조립 액션
  fastify.post("/:id/assemble", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const { id } = request.params as any;
    const body = request.body as any;
    const result = await fastify.productMasterService.assembleBundle(id, {
      components: body.components ?? [],
      output: body.output ?? {},
      createdBy: request.userId,
    });
    return reply.status(201).send(result);
  });
}

export async function contractRoutes(fastify: FastifyInstance) {
  // 조회: 전체 허용
  fastify.get("/", async (request) => {
    const { search, status, page, limit, sortBy, sortOrder } = request.query as any;
    return fastify.contractService.list({
      search: search || undefined,
      status: status || undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      ...(sortBy && { sortBy }),
      ...((sortOrder === "asc" || sortOrder === "desc") && { sortOrder }),
    });
  });

  fastify.get("/:id", async (request) => {
    return fastify.contractService.getById((request.params as any).id);
  });

  // 생성/수정: ADMIN, MANAGER
  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const result = await fastify.contractService.create({
      ...(request.body as any),
      createdBy: request.userId || "system",
    });
    return reply.status(201).send(result);
  });

  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { id } = request.params as any;
    return fastify.contractService.update(id, request.body as any);
  });

  // 삭제: ADMIN만
  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.contractService.remove((request.params as any).id);
    return reply.status(204).send();
  });

  // v1.6.1 (2026-05-15): 계약 확정 — PROSPECTIVE → ACTIVE
  fastify.post("/:id/finalize", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { id } = request.params as any;
    const body = request.body as { contractNumber: string; contractDate?: string };
    return fastify.contractService.finalize(id, body);
  });

  // 마이그레이션(엑셀 일괄 업로드): ADMIN 전용. records 배열이 크므로 bodyLimit 상향.
  fastify.post(
    "/import/preview",
    { preHandler: [requireRole("ADMIN")], bodyLimit: 26_214_400 },
    async (request) => {
      const { records } = (request.body ?? {}) as { records?: any[] };
      return fastify.contractService.importPreview(records ?? []);
    },
  );

  fastify.post(
    "/import",
    { preHandler: [requireRole("ADMIN")], bodyLimit: 26_214_400 },
    async (request, reply) => {
      const { records } = (request.body ?? {}) as { records?: any[] };
      const result = await fastify.contractService.importBulk(records ?? [], request.userId || "migration");
      return reply.status(201).send(result);
    },
  );
}

export async function overseasOrderRoutes(fastify: FastifyInstance) {
  // 조회: 전체 허용
  fastify.get("/", async (request) => {
    const { search, status, currency, orderType, contractId, page, limit, sortBy, sortOrder, hasPayment } = request.query as any;
    return fastify.overseasOrderService.list({
      search: search || undefined,
      status: status || undefined,
      currency: currency || undefined,
      orderType: orderType || undefined,
      contractId: contractId || undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      ...(sortBy && { sortBy }),
      ...((sortOrder === "asc" || sortOrder === "desc") && { sortOrder }),
      ...(hasPayment === "true" && { hasPayment: true }),
    });
  });

  fastify.get("/dashboard", async () => {
    return fastify.overseasOrderService.getDashboardStats();
  });

  fastify.get("/:id", async (request) => {
    return fastify.overseasOrderService.getById((request.params as any).id);
  });

  // 생성: ADMIN, MANAGER, OPERATOR (영업팀원도 발주 등록 가능)
  fastify.post("/", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const result = await fastify.overseasOrderService.create({
      ...(request.body as any),
      orderedBy: request.userId || "system",
    });
    return reply.status(201).send(result);
  });

  // 수정: ADMIN, MANAGER
  fastify.patch("/:id", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { id } = request.params as any;
    return fastify.overseasOrderService.update(id, request.body as any);
  });

  // 상태 전환: ADMIN, MANAGER, OPERATOR
  fastify.post("/:id/transition", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { id } = request.params as any;
    const { status, transitionDate } = request.body as any;
    return fastify.overseasOrderService.transition(id, status, request.userId || "system", transitionDate);
  });

  // v1.6 (2026-05-14): 결재 상신 취소 — PENDING_APPROVAL → DRAFT
  fastify.post("/:id/cancel-submission", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { id } = request.params as any;
    return fastify.overseasOrderService.cancelSubmission(id, request.userId);
  });

  // 삭제: ADMIN만
  fastify.delete("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.overseasOrderService.remove((request.params as any).id);
    return reply.status(204).send();
  });

  // ─── Items (ADMIN, MANAGER) ────────────────────────────────────────────

  fastify.post("/:id/items", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const { id } = request.params as any;
    const result = await fastify.overseasOrderService.addItem(id, request.body as any);
    return reply.status(201).send(result);
  });

  fastify.patch("/items/:itemId", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { itemId } = request.params as any;
    return fastify.overseasOrderService.updateItem(itemId, request.body as any);
  });

  fastify.delete("/items/:itemId", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.overseasOrderService.removeItem((request.params as any).itemId);
    return reply.status(204).send();
  });

  // ─── Partial Receipt (ADMIN, MANAGER) ──────────────────────────────────

  fastify.post("/:id/receive", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { id } = request.params as any;
    const { receipts } = request.body as any;
    const updated = await fastify.overseasOrderService.receiveItems(id, receipts, request.userId || "system");

    // v1.6.1 (2026-05-15): 도착 처리 후 자동으로 InboundRequest(PENDING) 생성/업데이트
    // 큐가 이미 PENDING으로 있으면 reuse — createFromOverseasOrder 가 idempotent
    try {
      await fastify.inboundRequestService.createFromOverseasOrder(id, request.userId || "system");
    } catch (e: any) {
      // 미입고 품목 없을 때 등 — 무시
      request.log.warn(`createFromOverseasOrder skipped: ${e.message}`);
    }
    return updated;
  });

  // ─── Inventory Link (ADMIN, MANAGER) ────────────────────────────────

  fastify.post("/items/:itemId/link-inventory", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request) => {
    const { itemId } = request.params as any;
    const { inventoryNo } = request.body as any;
    return fastify.overseasOrderService.linkInventory(itemId, inventoryNo);
  });

  fastify.delete("/items/:itemId/inventory/:inventoryId", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    await fastify.overseasOrderService.unlinkInventory((request.params as any).inventoryId);
    return reply.status(204).send();
  });

  // ─── Progress Logs ─────────────────────────────────────────────────────

  fastify.get("/:id/progress", async (request) => {
    const { id } = request.params as any;
    const { page, limit } = request.query as any;
    return fastify.orderProgressService.list(id, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  });

  fastify.post("/:id/progress", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const { id } = request.params as any;
    const result = await fastify.orderProgressService.create(id, {
      ...(request.body as any),
      updatedBy: request.userId || "system",
    });
    return reply.status(201).send(result);
  });

  fastify.delete("/progress/:logId", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.orderProgressService.remove((request.params as any).logId);
    return reply.status(204).send();
  });
}
