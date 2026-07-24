// 게시판(auth) @멘션 → project 알림 벨로 적재 요청.
//   게시글/덧글 본문은 auth DB에 있으므로 preview/linkUrl을 함께 넘겨 저장(저장형).
//   best-effort + 짧은 재시도. 게시글/덧글 저장은 이 호출과 무관하게 성공해야 하므로 절대 throw 안 함.

const PROJECT_INTERNAL_URL = process.env.PROJECT_SERVICE_URL ?? "http://project-service:3003";

export interface NotifyMentionsInput {
  sourceType: "POST" | "BOARD_COMMENT";
  sourceId: string;
  userIds: string[];
  actorId: string;
  preview: string;
  linkUrl: string;
}

export async function notifyMentions(input: NotifyMentionsInput): Promise<void> {
  const userIds = [...new Set((input.userIds ?? []).filter(Boolean))];
  if (userIds.length === 0) return;

  const token = process.env.INTERNAL_API_TOKEN as string;
  const body = JSON.stringify({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    userIds,
    actorId: input.actorId,
    preview: input.preview.slice(0, 200),
    linkUrl: input.linkUrl,
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${PROJECT_INTERNAL_URL}/internal/mentions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Token": token },
        body,
      });
      if (res.ok) return;
    } catch {
      /* 재시도 */
    }
    await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
  }
  console.warn(`[mention-notify] failed sourceType=${input.sourceType} sourceId=${input.sourceId}`);
}
