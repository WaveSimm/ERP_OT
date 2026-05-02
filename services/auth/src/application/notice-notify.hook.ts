import { PrismaClient, UserRole } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";

const ATTENDANCE_URL = process.env.ATTENDANCE_SERVICE_URL ?? "http://attendance-service:3004";
// 보안 일괄패치 PDCA Layer 1 (C3): startup-time Zod env 검증으로 보장
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN as string;

export interface NoticeNotifyContext {
  postId: string;
  boardCode: string;
  boardName: string;
  title: string;
  contentSummary: string;
  priority: number;
  publishingDepartmentId: string | null;
  readAudience: "ALL" | "DEPARTMENT" | "ROLE";
  audienceTargetId: string | null;
  // 글 단위 대상 부서 (부서 공지 — 보드 audience보다 우선)
  targetDepartmentId?: string | null;
}

export class NoticeNotifyHook {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async fire(ctx: NoticeNotifyContext): Promise<void> {
    try {
      const userIds = await this.collectUserIds(ctx);
      if (userIds.length === 0) {
        this.logger.warn({ ctx }, "[notice-notify] no audience users");
        return;
      }

      const linkUrl = `/board/notice/${ctx.boardCode}/${ctx.postId}`;
      const body = {
        userIds,
        type: "notice.published",
        source: "board",
        title: `[${ctx.boardName}] ${ctx.title}`,
        body: ctx.contentSummary,
        priority: ctx.priority >= 2 ? 1 : 2, // URGENT(2)→1, IMPORTANT(1)→2, NORMAL(0)→2
        linkUrl,
        metadata: {
          postId: ctx.postId,
          boardCode: ctx.boardCode,
        },
      };

      const res = await fetch(`${ATTENDANCE_URL}/internal/notifications/bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": INTERNAL_TOKEN,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        this.logger.error({ status: res.status, text, ctx }, "[notice-notify] attendance API failed");
        return;
      }
      this.logger.info({ count: userIds.length, postId: ctx.postId }, "[notice-notify] dispatched");
    } catch (err) {
      this.logger.error({ err, ctx }, "[notice-notify] failed");
    }
  }

  private async collectUserIds(ctx: NoticeNotifyContext): Promise<string[]> {
    // 1. 글 단위 targetDepartmentId 지정 시 — 보드 audience보다 우선
    if (ctx.targetDepartmentId) {
      const profiles = await this.prisma.userProfile.findMany({
        where: { departmentId: ctx.targetDepartmentId },
        select: { userId: true },
      });
      return profiles.map((p) => p.userId);
    }

    // 2. 보드 audience 기반
    switch (ctx.readAudience) {
      case "ALL": {
        const users = await this.prisma.user.findMany({
          where: { isActive: true },
          select: { id: true },
        });
        return users.map((u) => u.id);
      }
      case "DEPARTMENT": {
        // 보드 audienceTargetId 우선, 없으면 발행자 부서로 fallback
        const deptId = ctx.audienceTargetId ?? ctx.publishingDepartmentId;
        if (!deptId) return [];
        const profiles = await this.prisma.userProfile.findMany({
          where: { departmentId: deptId },
          select: { userId: true },
        });
        return profiles.map((p) => p.userId);
      }
      case "ROLE": {
        if (!ctx.audienceTargetId) return [];
        const role = ctx.audienceTargetId as UserRole;
        const users = await this.prisma.user.findMany({
          where: { isActive: true, role },
          select: { id: true },
        });
        return users.map((u) => u.id);
      }
    }
  }
}
