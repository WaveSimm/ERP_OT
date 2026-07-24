// task→projectId 해석에 필요한 최소 구조만 요구 (PrismaClient 전체 타입 비의존 — 클라이언트 재생성과 무관하게 컴파일 안정).
type TaskLookupClient = {
  task: { findUnique(args: { where: { id: string }; select: { projectId: true } }): Promise<{ projectId: string } | null> };
};

// 멘션 출처별 벨 제목 (프론트 SOURCE_LABEL과 문구 일치)
const SOURCE_TITLE: Record<string, string> = {
  COMMENT: "댓글에서 회원님을 멘션했습니다",
  WORKLOG: "작업일지에서 회원님을 멘션했습니다",
  ISSUE: "이슈에서 회원님을 멘션했습니다",
  POST: "게시글에서 회원님을 멘션했습니다",
  BOARD_COMMENT: "덧글에서 회원님을 멘션했습니다",
};

export interface MentionBellInput {
  sourceType: string;
  userIds: (string | null | undefined)[];
  actorId?: string | null;
  preview?: string | null; // 멘션 본문(내용)
  taskId?: string | null; // 태스크계 딥링크용 (projectId 해석)
  linkUrl?: string | null; // 저장형(게시판) 딥링크 — 있으면 우선
}

/**
 * 멘션을 알림 벨(attendance.notifications)에도 적재한다.
 * 벨은 attendance 를 단일 소스로 읽으므로, 멘션이 벨에 뜨려면 여기에 넣어야 한다.
 * best-effort — 실패해도 멘션 생성 자체엔 영향 없음(절대 throw 안 함).
 */
export async function notifyMentionBell(
  prisma: TaskLookupClient,
  input: MentionBellInput,
): Promise<void> {
  try {
    const userIds = [...new Set(input.userIds.filter((u): u is string => !!u))];
    if (userIds.length === 0) return;

    const title = SOURCE_TITLE[input.sourceType] ?? "회원님을 멘션했습니다";
    const body = (input.preview ?? "").slice(0, 500);

    let linkUrl = input.linkUrl ?? undefined;
    if (!linkUrl && input.taskId) {
      const task = await prisma.task.findUnique({
        where: { id: input.taskId },
        select: { projectId: true },
      });
      if (task) linkUrl = `/projects/${task.projectId}?taskId=${input.taskId}`;
    }

    const attUrl = process.env.ATTENDANCE_SERVICE_URL ?? "http://attendance-service:3004";
    const token = process.env.INTERNAL_API_TOKEN as string;
    await fetch(`${attUrl}/internal/notifications/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": token },
      body: JSON.stringify({
        userIds,
        type: `mention.${input.sourceType.toLowerCase()}`,
        source: "mention",
        title,
        body,
        priority: 2,
        ...(linkUrl ? { linkUrl } : {}),
        metadata: { sourceType: input.sourceType, actorId: input.actorId ?? null },
      }),
    });
  } catch {
    /* best-effort: 벨 적재 실패는 무시 */
  }
}
