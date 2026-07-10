import { FastifyInstance } from "fastify";
import { requireRole, requireManager, requireAdmin } from "../middleware/auth.middleware.js";

export async function folderRoutes(fastify: FastifyInstance) {
  // 전체 폴더 목록
  fastify.get("/", async (request) => {
    // 보안 일괄패치 PDCA Layer 4 (NEW-1): "unknown" fallback 제거 — Layer 2 requireAuth가 userId 보장
    const userId = request.userId;
    return fastify.folderService.list(userId);
  });

  // 폴더 생성
  fastify.post<{ Body: { name: string; parentId?: string; sortOrder?: number } }>(
    "/",
    { preHandler: requireManager() },
    async (request, reply) => {
      // 보안 일괄패치 PDCA Layer 4 (NEW-1): "unknown" fallback 제거 — Layer 2 requireAuth가 userId 보장
      const userId = request.userId;
      const result = await fastify.folderService.create(request.body, userId);
      return reply.status(201).send(result);
    }
  );

  // 폴더 수정 (이름, 부모, 순서)
  fastify.patch<{ Params: { id: string }; Body: { name?: string; parentId?: string; sortOrder?: number } }>(
    "/:id",
    { preHandler: requireManager() },
    async (request, reply) => {
      const { id } = request.params;
      try {
        return await fastify.folderService.update(id, request.body);
      } catch (e: any) {
        return reply.status(400).send({ code: "FOLDER_LOCKED", message: e?.message ?? "수정할 수 없습니다." });
      }
    }
  );

  // 폴더 삭제
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requireAdmin() },
    async (request, reply) => {
      const { id } = request.params;
      try {
        await fastify.folderService.remove(id);
      } catch (e: any) {
        return reply.status(400).send({ code: "FOLDER_LOCKED", message: e?.message ?? "삭제할 수 없습니다." });
      }
      return reply.status(204).send();
    }
  );

  // 폴더에 프로젝트 추가
  fastify.post<{ Params: { id: string }; Body: { projectId: string; sortOrder?: number } }>(
    "/:id/projects",
    { preHandler: requireManager() },
    async (request, reply) => {
      const { id } = request.params;
      const { projectId, sortOrder } = request.body;
      const result = await fastify.folderService.addProject(id, projectId, sortOrder);
      return reply.status(201).send(result);
    }
  );

  // 폴더에서 프로젝트 제거
  fastify.delete<{ Params: { id: string; projectId: string } }>(
    "/:id/projects/:projectId",
    { preHandler: requireAdmin() },
    async (request, reply) => {
      const { id, projectId } = request.params;
      await fastify.folderService.removeProject(id, projectId);
      return reply.status(204).send();
    }
  );

  // 폴더 내 프로젝트 순서 변경
  fastify.patch<{ Params: { id: string }; Body: { projectIds: string[] } }>(
    "/:id/reorder",
    { preHandler: requireManager() },
    async (request) => {
      const { id } = request.params;
      const { projectIds } = request.body;
      return fastify.folderService.reorderProjects(id, projectIds);
    }
  );

  // 폴더 순서 일괄 변경
  fastify.patch<{ Body: { folderIds: string[] } }>(
    "/reorder",
    { preHandler: requireManager() },
    async (request) => {
      const { folderIds } = request.body;
      return fastify.folderService.reorderFolders(folderIds);
    }
  );

  // ─── 내 즐겨찾기 (사용자별 프라이빗 — 로그인한 누구나, 본인 것만) ──────────────
  // 내 즐겨찾기 프로젝트 목록
  fastify.get("/favorites", async (request) => {
    const projectIds = await fastify.folderService.listFavorites(request.userId);
    return { projectIds };
  });

  // 즐겨찾기 추가
  fastify.post<{ Params: { projectId: string } }>(
    "/favorites/:projectId",
    async (request, reply) => {
      const result = await fastify.folderService.addFavorite(request.userId, request.params.projectId);
      return reply.status(201).send(result);
    }
  );

  // 즐겨찾기 해제
  fastify.delete<{ Params: { projectId: string } }>(
    "/favorites/:projectId",
    async (request, reply) => {
      await fastify.folderService.removeFavorite(request.userId, request.params.projectId);
      return reply.status(204).send();
    }
  );
}
