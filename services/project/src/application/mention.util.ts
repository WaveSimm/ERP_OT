import type { PrismaClient } from "@prisma/client";

type MentionClient = Pick<PrismaClient, "mention">;

export interface CreateMentionsInput {
  sourceType: string; // "COMMENT" | "WORKLOG" | "ISSUE" | "POST" | "BOARD_COMMENT"
  sourceId: string;
  taskId?: string | null;
  userIds: (string | undefined | null)[];
  actorId?: string | undefined;
}

/**
 * 폴리모픽 멘션 생성. 자기 자신·중복 제외. 생성한 userId 목록 반환.
 * (댓글·작업일지·이슈 등 여러 서비스에서 공용 사용)
 */
export async function createMentions(prisma: MentionClient, input: CreateMentionsInput): Promise<string[]> {
  // 자기 멘션 허용(의도적 리마인더 용도) — actorId 제외하지 않음
  const ids = [...new Set(input.userIds.filter((u): u is string => !!u))];
  if (ids.length === 0) return [];
  await prisma.mention.createMany({
    data: ids.map((userId) => ({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      taskId: input.taskId ?? null,
      userId,
      actorId: input.actorId ?? null,
    })),
    skipDuplicates: true,
  });
  return ids;
}

/** 기존 멘션 교체(수정 경로): 해당 source의 멘션 삭제 후 재생성. */
export async function syncMentions(prisma: MentionClient, input: CreateMentionsInput): Promise<string[]> {
  await prisma.mention.deleteMany({ where: { sourceType: input.sourceType, sourceId: input.sourceId } });
  return createMentions(prisma, input);
}
