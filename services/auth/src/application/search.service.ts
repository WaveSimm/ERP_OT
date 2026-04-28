import { PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import type { EmbeddingService } from "./embedding.service";
import { canRead } from "./board-permissions";
import type { AuthUserContext } from "../domain/board.types";
import { searchConfig } from "./search-config";

const PROJECT_INTERNAL_URL = process.env.PROJECT_SERVICE_URL ?? "http://project-service:3003";
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN ?? "";

export class SearchError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "SearchError";
  }
}

export interface SearchResultItem {
  type: "post" | "worklog";
  id: string;
  title: string;
  snippet: string;
  author: string;
  publishedAt: string;
  url: string;
  boardName?: string;
  projectName?: string;
  taskName?: string;
  score: number;
}

function summarize(text: string, maxLen: number): string {
  const t = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/[#>*_`~\-\[\]\(\)!]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > maxLen ? t.slice(0, maxLen) + "..." : t;
}

export class SearchService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly embeddingService: EmbeddingService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async search(
    q: string,
    scope: "all" | "posts" | "worklogs",
    limit: number,
    user: AuthUserContext & { email: string },
  ): Promise<{ took: number; items: SearchResultItem[] }> {
    if (q.trim().length < 2) {
      throw new SearchError("QUERY_TOO_SHORT", "검색어는 2자 이상 입력해주세요.", 400);
    }

    const t0 = Date.now();

    let queryVec: number[];
    try {
      queryVec = await this.embeddingService.embedText(q);
    } catch (err) {
      this.logger.error({ err: String(err) }, "[search] embed failed");
      throw new SearchError("SEARCH_UNAVAILABLE", "검색 서비스를 사용할 수 없습니다.", 503);
    }

    const tasks: Promise<SearchResultItem[]>[] = [];
    if (scope === "all" || scope === "posts") {
      tasks.push(this.searchPosts(queryVec, q.trim(), limit * 2, user));
    }
    if (scope === "all" || scope === "worklogs") {
      tasks.push(this.searchWorkLogsRemote(queryVec, q.trim(), limit * 2, user));
    }

    const settled = await Promise.allSettled(tasks);
    const all: SearchResultItem[] = [];
    for (const s of settled) {
      if (s.status === "fulfilled") all.push(...s.value);
      else this.logger.warn({ err: String(s.reason) }, "[search] partial failure");
    }

    all.sort((a, b) => b.score - a.score);
    const items = all.slice(0, limit);

    return { took: Date.now() - t0, items };
  }

  private async searchPosts(
    queryVec: number[],
    q: string,
    k: number,
    user: AuthUserContext & { email: string },
  ): Promise<SearchResultItem[]> {
    const literal = this.embeddingService.toSqlLiteral(queryVec);
    const cfg = searchConfig;
    const k3 = k * 3;
    const rows = await this.prisma.$queryRaw<any[]>`
      WITH scored AS (
        SELECT p.id, p.title, p.content, p.published_at AS "publishedAt",
               p.is_deleted AS "isDeleted",
               p.target_department_id AS "targetDepartmentId",
               p.author_id AS "authorId",
               u.name AS "authorName",
               b.code AS "boardCode", b.name AS "boardName",
               b.write_roles AS "writeRoles",
               b.read_audience AS "readAudience",
               b.audience_target_id AS "audienceTargetId",
               b.allow_comments AS "allowComments",
               c.code AS "catCode",
               (1 - (p.embedding <=> ${literal}::vector)) AS embed_score,
               (CASE WHEN p.title   ILIKE '%' || ${q} || '%' THEN ${cfg.titleExactBonus}::float ELSE 0 END
                + CASE WHEN p.content ILIKE '%' || ${q} || '%' THEN ${cfg.contentExactBonus}::float ELSE 0 END) AS exact_bonus,
               GREATEST(
                 COALESCE(similarity(p.title,   ${q}), 0) * ${cfg.titleTrgmWeight}::float,
                 COALESCE(similarity(p.content, ${q}), 0) * ${cfg.contentTrgmWeight}::float
               ) AS trgm_score
        FROM public.board_posts p
        JOIN public.boards b ON b.id = p.board_id
        JOIN public.board_categories c ON c.id = b.category_id
        JOIN public.auth_users u ON u.id = p.author_id
        WHERE p.embedding IS NOT NULL AND p.is_deleted = false
        ORDER BY p.embedding <=> ${literal}::vector
        LIMIT ${k3}
      ),
      final AS (
        SELECT *,
          embed_score * ${cfg.embedWeight}::float
          + GREATEST(exact_bonus, trgm_score) * ${cfg.keywordWeight}::float
          + CASE WHEN exact_bonus > 0 THEN ${cfg.keywordMatchBonus}::float ELSE 0 END
            AS score
        FROM scored
      )
      SELECT * FROM final
      WHERE score >= ${cfg.minScore}::float
      ORDER BY score DESC
      LIMIT ${k}
    `;

    const filtered = rows.filter((r) => {
      const board = {
        writeRoles: r.writeRoles,
        readAudience: r.readAudience,
        audienceTargetId: r.audienceTargetId,
        allowComments: r.allowComments,
      };
      const post = { authorId: r.authorId, isDeleted: r.isDeleted };
      return canRead(board, post, user);
    });

    return filtered.map((r) => ({
      type: "post" as const,
      id: r.id,
      title: r.title,
      snippet: summarize(r.content, 200),
      author: r.authorName,
      publishedAt: new Date(r.publishedAt).toISOString(),
      url: `/board/${r.catCode}/${r.boardCode}/${r.id}`,
      boardName: r.boardName,
      score: typeof r.score === "string" ? parseFloat(r.score) : Number(r.score),
    }));
  }

  private async searchWorkLogsRemote(
    queryVec: number[],
    q: string,
    k: number,
    user: AuthUserContext & { email: string },
  ): Promise<SearchResultItem[]> {
    try {
      const res = await fetch(`${PROJECT_INTERNAL_URL}/internal/work-logs/semantic-search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          queryVec,
          q,
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          limit: k,
        }),
      });
      if (!res.ok) {
        this.logger.warn({ status: res.status }, "[search-worklogs] remote failed");
        return [];
      }
      const data = (await res.json()) as any[];
      return data.map((r) => ({
        type: "worklog" as const,
        id: r.id,
        title: `${r.taskName ?? ""}${r.segmentName ? " · " + r.segmentName : ""}`.trim() || r.id,
        snippet: summarize(r.content, 200),
        author: r.authorName ?? "",
        publishedAt: r.workedAt,
        url: `/work-logs/${r.projectId}`,
        projectName: r.projectName,
        taskName: r.taskName,
        score: typeof r.score === "string" ? parseFloat(r.score) : Number(r.score),
      }));
    } catch (err) {
      this.logger.warn({ err: String(err) }, "[search-worklogs] remote unreachable");
      return [];
    }
  }
}
