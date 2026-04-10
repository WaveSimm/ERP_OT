import { FastifyInstance } from "fastify";

export async function folderRoutes(fastify: FastifyInstance) {
  // 전체 폴더 목록
  fastify.get("/", async (request) => {
    const userId = (request as any).userId || (request as any).user?.id || "unknown";
    return fastify.folderService.list(userId);
  });

  // 폴더 생성
  fastify.post("/", async (request, reply) => {
    const userId = (request as any).userId || (request as any).user?.id || "unknown";
    const result = await fastify.folderService.create(request.body as any, userId);
    return reply.status(201).send(result);
  });

  // 폴더 수정 (이름, 부모, 순서)
  fastify.patch("/:id", async (request) => {
    const { id } = request.params as any;
    return fastify.folderService.update(id, request.body as any);
  });

  // 폴더 삭제
  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params as any;
    await fastify.folderService.remove(id);
    return reply.status(204).send();
  });

  // 폴더에 프로젝트 추가
  fastify.post("/:id/projects", async (request, reply) => {
    const { id } = request.params as any;
    const { projectId, sortOrder } = request.body as any;
    const result = await fastify.folderService.addProject(id, projectId, sortOrder);
    return reply.status(201).send(result);
  });

  // 폴더에서 프로젝트 제거
  fastify.delete("/:id/projects/:projectId", async (request, reply) => {
    const { id, projectId } = request.params as any;
    await fastify.folderService.removeProject(id, projectId);
    return reply.status(204).send();
  });

  // 폴더 내 프로젝트 순서 변경
  fastify.patch("/:id/reorder", async (request) => {
    const { id } = request.params as any;
    const { projectIds } = request.body as any;
    return fastify.folderService.reorderProjects(id, projectIds);
  });

  // 폴더 순서 일괄 변경
  fastify.patch("/reorder", async (request) => {
    const { folderIds } = request.body as any;
    return fastify.folderService.reorderFolders(folderIds);
  });
}
