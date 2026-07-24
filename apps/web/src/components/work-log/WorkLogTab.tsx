"use client";

import { useEffect, useState } from "react";
import { workLogApi, getUser } from "@/lib/api";
import { extractMentionIds } from "@/components/MentionInput";
import WorkLogForm, { type WorkLogFormValue } from "./WorkLogForm";
import WorkLogTimeline from "./WorkLogTimeline";
import { type WorkLogItem } from "./WorkLogCard";

interface Props {
  taskId: string;
  segments?: Array<{ id: string; name: string }>;
}

export default function WorkLogTab({ taskId, segments }: Props) {
  const me = getUser();
  const isAdmin = me?.role === "ADMIN";
  const userId = me?.id ?? "";

  const [logs, setLogs] = useState<WorkLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      const data = await workLogApi.listByTask(taskId);
      setLogs((data ?? []) as WorkLogItem[]);
    } catch (err: any) {
      setError(err?.message ?? "목록 로드 실패");
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    workLogApi
      .listByTask(taskId)
      .then((data) => {
        if (!cancelled) setLogs((data ?? []) as WorkLogItem[]);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? "목록 로드 실패");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const handleCreate = async (v: WorkLogFormValue) => {
    const mentionedUserIds = await extractMentionIds(v.content);
    const payload: any = { content: v.content, workedAt: v.workedAt, mentionedUserIds };
    if (v.segmentId) payload.segmentId = v.segmentId;
    await workLogApi.create(taskId, payload);
    await reload();
  };

  const handleUpdate = async (id: string, v: WorkLogFormValue) => {
    const mentionedUserIds = await extractMentionIds(v.content);
    await workLogApi.update(id, { content: v.content, workedAt: v.workedAt, mentionedUserIds });
    await reload();
  };

  const handleDelete = async (id: string) => {
    await workLogApi.remove(id);
    await reload();
  };

  return (
    <div className="space-y-3">
      <WorkLogForm
        segments={segments ?? []}
        onSubmit={handleCreate}
        submitLabel="비고 등록"
        showSegment
      />

      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full" />
        </div>
      ) : (
        <WorkLogTimeline
          logs={logs}
          segments={segments ?? []}
          currentUserId={userId}
          isAdmin={isAdmin}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
