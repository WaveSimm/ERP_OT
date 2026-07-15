"use client";

import { useEffect, useRef, useState } from "react";
import { taskAttachmentApi, type TaskAttachment } from "@/lib/api";
import { fmtDateTime24 } from "@/lib/datetime";

interface Props {
  taskId: string;
}

// 확장자 accept 힌트 (서버가 확장자 기준으로 최종 검증)
const IMAGE_ACCEPT = ".jpg,.jpeg,.png,.gif,.webp";
const FILE_ACCEPT = ".pdf,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function TaskAttachmentSection({ taskId }: Props) {
  const [items, setItems] = useState<TaskAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<"FILE" | "IMAGE" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      setItems((await taskAttachmentApi.list(taskId)) ?? []);
    } catch {
      setItems([]);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    taskAttachmentApi
      .list(taskId)
      .then((data) => { if (!cancelled) setItems(data ?? []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [taskId]);

  const handlePick = async (category: "FILE" | "IMAGE", e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!file) return;
    setError(null);
    setUploading(category);
    try {
      await taskAttachmentApi.upload(taskId, file, category);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "업로드에 실패했습니다.");
    } finally {
      setUploading(null);
    }
  };

  const handleDelete = async (att: TaskAttachment) => {
    if (!confirm(`"${att.fileName}" 을(를) 삭제하시겠습니까?`)) return;
    setError(null);
    try {
      await taskAttachmentApi.delete(att.id);
      setItems((prev) => prev.filter((x) => x.id !== att.id));
    } catch (err: any) {
      setError(err?.message ?? "삭제에 실패했습니다.");
    }
  };

  const images = items.filter((x) => x.category === "IMAGE");
  const files = items.filter((x) => x.category !== "IMAGE");

  const renderRow = (att: TaskAttachment) => (
    <li key={att.id} className="flex items-center gap-2 py-1.5 group">
      <a
        href={taskAttachmentApi.downloadUrl(att.id)}
        className="flex-1 min-w-0 flex items-center gap-2 text-sm text-gray-800 hover:text-blue-600"
        title={`${att.fileName} — 클릭하여 다운로드`}
      >
        <span className="shrink-0">{att.category === "IMAGE" ? "🖼️" : "📄"}</span>
        <span className="truncate">{att.fileName}</span>
        <span className="shrink-0 text-xs text-gray-400">{fmtSize(att.fileSize)}</span>
      </a>
      <span className="shrink-0 text-xs text-gray-400 hidden sm:inline">{fmtDateTime24(att.createdAt, { short: true })}</span>
      <button
        onClick={() => handleDelete(att)}
        className="shrink-0 text-gray-300 hover:text-red-500 text-sm opacity-0 group-hover:opacity-100 transition-opacity"
        title="삭제"
      >×</button>
    </li>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase">📎 첨부</h3>
        <div className="flex gap-1.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading !== null}
            className="px-2.5 py-1 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >{uploading === "FILE" ? "업로드 중…" : "파일 추가"}</button>
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={uploading !== null}
            className="px-2.5 py-1 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >{uploading === "IMAGE" ? "업로드 중…" : "이미지 추가"}</button>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept={FILE_ACCEPT} className="hidden" onChange={(e) => handlePick("FILE", e)} />
      <input ref={imageInputRef} type="file" accept={IMAGE_ACCEPT} className="hidden" onChange={(e) => handlePick("IMAGE", e)} />

      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-400 text-center py-4">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">첨부된 파일이 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {files.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1">파일 ({files.length})</p>
              <ul className="divide-y divide-gray-100">{files.map(renderRow)}</ul>
            </div>
          )}
          {images.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1">이미지 ({images.length})</p>
              <ul className="divide-y divide-gray-100">{images.map(renderRow)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
