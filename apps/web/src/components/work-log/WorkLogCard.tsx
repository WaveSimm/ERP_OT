"use client";

import { useState } from "react";
import PostMarkdownView from "@/components/board/PostMarkdownView";
import WorkLogForm, { type WorkLogFormValue } from "./WorkLogForm";

export interface WorkLogItem {
  id: string;
  taskId: string;
  segmentId: string | null;
  segmentName: string | null;
  authorId: string;
  authorName: string;
  content: string;
  workedAt: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  log: WorkLogItem;
  segments?: Array<{ id: string; name: string }>;
  canEdit: boolean;
  onUpdate: (id: string, v: WorkLogFormValue) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  taskName?: string;
  projectName?: string;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  const dt = new Date(iso);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export default function WorkLogCard({ log, segments, canEdit, onUpdate, onDelete, taskName, projectName }: Props) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (editing) {
    return (
      <div className="border border-gray-200 rounded-lg p-3">
        <WorkLogForm
          segments={segments ?? []}
          initial={{ content: log.content, workedAt: log.workedAt, segmentId: log.segmentId }}
          showSegment={false}
          onSubmit={async (v) => {
            await onUpdate(log.id, v);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          submitLabel="저장"
        />
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="text-sm font-medium text-gray-800">{log.authorName || "익명"}</span>
        {projectName && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">
            {projectName}
          </span>
        )}
        {taskName && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
            {taskName}
          </span>
        )}
        {log.segmentName && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
            {log.segmentName}
          </span>
        )}
        <span className="text-xs text-gray-400">{timeAgo(log.createdAt)}</span>
        {log.updatedAt !== log.createdAt && (
          <span className="text-xs text-gray-400">(수정됨)</span>
        )}
        <span className="ml-auto" />
        {canEdit && !log.isDeleted && (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              수정
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!confirm("이 비고를 삭제하시겠습니까?")) return;
                setDeleting(true);
                try {
                  await onDelete(log.id);
                } finally {
                  setDeleting(false);
                }
              }}
              disabled={deleting}
              className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
            >
              삭제
            </button>
          </>
        )}
      </div>
      <div className={log.isDeleted ? "text-sm text-gray-400 italic" : ""}>
        {log.isDeleted ? "(삭제된 비고)" : <PostMarkdownView content={log.content} />}
      </div>
    </div>
  );
}
