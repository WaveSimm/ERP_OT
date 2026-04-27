import type { FastifyInstance } from "fastify";
import type { BoardService } from "../../application/board.service";
import type { AuthService } from "../../application/auth.service";
import { createAuthHook } from "../middleware/auth.middleware";

export async function boardRoutes(
  app: FastifyInstance,
  opts: { boardService: BoardService; authService: AuthService },
) {
  const { boardService, authService } = opts;
  const authenticate = createAuthHook(authService);

  // GET /api/v1/board-categories
  app.get("/board-categories", { preHandler: [authenticate] }, async (_req, reply) => {
    const categories = await boardService.listCategories();
    return reply.send(categories);
  });

  // GET /api/v1/boards?categoryCode=notice
  app.get("/boards", { preHandler: [authenticate] }, async (req, reply) => {
    const q = req.query as { categoryCode?: string };
    const boards = await boardService.listBoards({ categoryCode: q.categoryCode });
    return reply.send(boards);
  });

  // GET /api/v1/boards/:code
  app.get("/boards/:code", { preHandler: [authenticate] }, async (req, reply) => {
    const { code } = req.params as { code: string };
    const board = await boardService.getBoardByCode(code);
    if (!board) return reply.code(404).send({ error: { code: "BOARD_NOT_FOUND", message: "보드를 찾을 수 없습니다." } });
    return reply.send(board);
  });
}
