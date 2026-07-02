"use client";

interface ActivityTabProps {
  activities: any[];
  projectDeployments: any[];
  userMap: Record<string, string>;
  commentContentMap: Record<string, string>;
  projectName?: string;
  onRefresh: () => void;
}

export default function ActivityTab({
  activities,
  projectDeployments,
  userMap,
  commentContentMap,
  projectName,
  onRefresh,
}: ActivityTabProps) {
  const ACTION_CFG: Record<string, { icon: string; label: string; bg: string; text: string }> = {
    "project.created":      { icon: "🏗️", label: "프로젝트 생성",  bg: "bg-gray-100",   text: "text-gray-600" },
    "project.updated":      { icon: "✏️", label: "프로젝트 수정",  bg: "bg-gray-100",   text: "text-gray-600" },
    TASK_CREATED:           { icon: "➕", label: "태스크 추가",    bg: "bg-green-100",  text: "text-green-700" },
    MILESTONE_CREATED:      { icon: "📌", label: "마일스톤 추가",  bg: "bg-purple-100", text: "text-purple-700" },
    TASK_DELETED:           { icon: "🗑️", label: "태스크 삭제",    bg: "bg-red-100",    text: "text-red-700" },
    TASK_RENAMED:           { icon: "✏️", label: "이름 변경",      bg: "bg-blue-100",   text: "text-blue-700" },
    TASK_NOTE_CHANGED:      { icon: "📝", label: "비고 변경",      bg: "bg-blue-100",   text: "text-blue-700" },
    TASK_STATUS_CHANGED:    { icon: "🔄", label: "상태 변경",      bg: "bg-yellow-100", text: "text-yellow-700" },
    TASK_PROGRESS_CHANGED:  { icon: "📊", label: "진도율 변경",    bg: "bg-indigo-100", text: "text-indigo-700" },
    TASK_SCHEDULE_CHANGED:  { icon: "📅", label: "일정 변경",      bg: "bg-teal-100",   text: "text-teal-700" },
    ASSIGNMENT_CHANGED:     { icon: "👤", label: "자원 배정",      bg: "bg-violet-100", text: "text-violet-700" },
    ASSIGNMENT_REMOVED:     { icon: "👤", label: "자원 해제",      bg: "bg-violet-100", text: "text-violet-700" },
    COMMENT_CREATED:        { icon: "💬", label: "댓글 작성",      bg: "bg-cyan-100",   text: "text-cyan-700" },
    COMMENT_UPDATED:        { icon: "💬", label: "댓글 수정",      bg: "bg-cyan-100",   text: "text-cyan-700" },
    COMMENT_DELETED:        { icon: "💬", label: "댓글 삭제",      bg: "bg-cyan-100",   text: "text-cyan-700" },
    ATTACHMENT_UPLOADED:    { icon: "📎", label: "파일 첨부",      bg: "bg-orange-100", text: "text-orange-700" },
    ATTACHMENT_DELETED:     { icon: "📎", label: "파일 삭제",      bg: "bg-orange-100", text: "text-orange-700" },
    DEPLOY_CREATED:        { icon: "🔧", label: "장비 투입",      bg: "bg-emerald-100", text: "text-emerald-700" },
    DEPLOY_ACTIVATED:      { icon: "🔧", label: "장비 가동",      bg: "bg-blue-100",   text: "text-blue-700" },
    DEPLOY_COMPLETED:      { icon: "🔧", label: "장비 회수",      bg: "bg-green-100",  text: "text-green-700" },
    DEPLOY_CANCELLED:      { icon: "🔧", label: "장비 투입 취소", bg: "bg-red-100",    text: "text-red-700" },
  };

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "방금 전";
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}일 전`;
    return new Date(iso).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
  };

  // 장비 투입 이벤트를 활동 피드에 합치기
  const deployActivities = projectDeployments.map((d: any) => {
    const statusAction: Record<string, string> = {
      PLANNED: "DEPLOY_CREATED", ACTIVE: "DEPLOY_ACTIVATED",
      COMPLETED: "DEPLOY_COMPLETED", CANCELLED: "DEPLOY_CANCELLED",
    };
    const sensorNames = d.sensors?.map((ds: any) => ds.sensor?.name).filter(Boolean).join(", ");
    const period = `${new Date(d.startDate).toLocaleDateString()} ~ ${d.endDate ? new Date(d.endDate).toLocaleDateString() : "미정"}`;
    return {
      id: `deploy-${d.id}`,
      action: statusAction[d.status] ?? "DEPLOY_CREATED",
      createdAt: d.createdAt,
      userId: d.createdBy,
      description: `${d.equipment?.name ?? "장비"} (${period})${sensorNames ? ` · 센서: ${sensorNames}` : ""}`,
      metadata: { equipmentName: d.equipment?.name },
    };
  });

  const allActivities = [...activities, ...deployActivities].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // 날짜별 그룹
  const grouped: { date: string; items: any[] }[] = [];
  for (const a of allActivities) {
    const date = new Date(a.createdAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
    const last = grouped[grouped.length - 1];
    if (last?.date === date) last.items.push(a);
    else grouped.push({ date, items: [a] });
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400">최근 활동 {allActivities.length}건</span>
        <button onClick={onRefresh} className="text-xs text-blue-500 hover:underline">새로고침</button>
      </div>

      {allActivities.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white rounded-xl border border-dashed border-gray-200">
          <div className="text-3xl mb-2">🕐</div>
          <p className="text-sm">활동 내역이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ date, items }) => (
            <div key={date}>
              <div className="flex items-center gap-2 mb-2">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="text-[11px] text-gray-400 shrink-0">{date}</span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>
              <div className="space-y-1.5">
                {items.map((a: any) => {
                  const cfg = ACTION_CFG[a.action] ?? { icon: "📋", label: a.action, bg: "bg-gray-100", text: "text-gray-600" };
                  const meta: any = typeof a.metadata === "object" && a.metadata !== null ? a.metadata : {};
                  return (
                    <div key={a.id} className="flex items-start gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3 hover:border-gray-200 transition-colors">
                      {/* 아이콘 */}
                      <div className={`w-8 h-8 rounded-full ${cfg.bg} flex items-center justify-center text-sm shrink-0`}>
                        {cfg.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        {/* 액션 + 작성자·시간 + 태스크명 */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
                            {cfg.label}
                          </span>
                          <span className="text-[11px] text-gray-500">
                            <span className="font-medium text-gray-600">{userMap[a.userId] ?? a.userId}</span>
                            {" · "}{timeAgo(a.createdAt)}
                          </span>
                          {meta.taskName && (
                            <span className="text-xs font-medium text-gray-800 truncate max-w-[180px]" title={meta.taskName}>
                              {meta.taskName}
                            </span>
                          )}
                          {projectName && !meta.taskName && (
                            <span className="text-xs text-gray-500 truncate">{projectName}</span>
                          )}
                        </div>
                        {/* 상세 내용 */}
                        {(() => {
                          if (a.action === "COMMENT_CREATED" || a.action === "COMMENT_UPDATED") {
                            // 1순위: 댓글 직접 조회 결과, 2순위: metadata.content, 3순위: 백엔드 enriched description
                            const GENERIC = ["댓글 작성", "댓글 수정"];
                            const text = commentContentMap[a.entityId] || meta.content ||
                              (a.description && !GENERIC.includes(a.description) ? a.description : null);
                            return text ? (
                              <div className="mt-1.5 bg-cyan-50 border-l-2 border-cyan-400 rounded-r-md px-2.5 py-1.5">
                                <p className="text-xs text-gray-700 break-words line-clamp-3 leading-relaxed" title={text}>
                                  {text}
                                </p>
                              </div>
                            ) : null;
                          }
                          if (a.action === "COMMENT_DELETED") {
                            return <p className="text-xs text-gray-400 mt-0.5 italic">{a.description}</p>;
                          }
                          // 프로젝트 수정: 변경 항목을 태그 형태로 표시
                          if (a.action === "project.updated") {
                            const changes: string[] = Array.isArray(meta.changes) ? meta.changes : [];
                            if (changes.length > 0) {
                              return (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {changes.map((c: string, i: number) => (
                                    <span key={i} className="text-[11px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 border border-gray-200">
                                      {c}
                                    </span>
                                  ))}
                                </div>
                              );
                            }
                            // 구형 generic 메시지("프로젝트 [...]이 수정되었습니다.") 는 표시하지 않음
                            const isGeneric = !a.description || /^프로젝트\s*\[.+\]이?\s*수정되었습니다/.test(a.description);
                            if (isGeneric) return null;
                            return (
                              <p className="text-xs text-gray-500 mt-0.5" title={a.description}>{a.description}</p>
                            );
                          }
                          // 태스크 수정: 태스크명 + 변경 내용
                          if (a.description) {
                            return (
                              <p className="text-xs text-gray-600 mt-0.5 truncate" title={a.description}>
                                {a.description}
                              </p>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
