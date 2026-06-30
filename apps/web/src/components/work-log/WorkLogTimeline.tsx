"use client";

import WorkLogCard, { type WorkLogItem } from "./WorkLogCard";
import { type WorkLogFormValue } from "./WorkLogForm";

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

function dayHeader(workedAt: string) {
  const d = new Date(workedAt + "T00:00:00");
  return `${workedAt} (${WEEKDAY_KO[d.getDay()]})`;
}

interface ProjectWorkLogItem extends WorkLogItem {
  taskName?: string;
  projectName?: string;
  projectId?: string;
}

interface Props {
  logs: ProjectWorkLogItem[];
  segments?: Array<{ id: string; name: string }>;
  currentUserId: string;
  isAdmin: boolean;
  showTaskName?: boolean;
  showProjectName?: boolean;
  projectId?: string;   // 단일 프로젝트 뷰의 기본 projectId(항목에 없을 때 폴백)
  onUpdate: (id: string, v: WorkLogFormValue) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export default function WorkLogTimeline({
  logs,
  segments,
  currentUserId,
  isAdmin,
  showTaskName,
  showProjectName,
  projectId,
  onUpdate,
  onDelete,
}: Props) {
  if (logs.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-gray-400">등록된 비고가 없습니다.</div>
    );
  }

  // 작업일별 그룹
  const groups: Record<string, ProjectWorkLogItem[]> = {};
  for (const l of logs) {
    if (!groups[l.workedAt]) groups[l.workedAt] = [];
    groups[l.workedAt]!.push(l);
  }
  const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-4">
      {sortedDates.map((date) => (
        <div key={date}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-gray-700">📅 {dayHeader(date)}</span>
            <span className="text-xs text-gray-400">— {groups[date]!.length}건</span>
          </div>
          <div className="space-y-2">
            {groups[date]!.map((l) => (
              <WorkLogCard
                key={l.id}
                log={l}
                segments={segments ?? []}
                canEdit={isAdmin || l.authorId === currentUserId}
                onUpdate={onUpdate}
                onDelete={onDelete}
                taskName={showTaskName ? l.taskName : undefined}
                projectName={showProjectName ? l.projectName : undefined}
                projectId={l.projectId ?? projectId}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
