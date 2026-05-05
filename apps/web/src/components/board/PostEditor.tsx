"use client";

import { useState, useRef, useEffect } from "react";
import PostMarkdownView from "./PostMarkdownView";
import AttachmentUploader, { type UploadedAttachment } from "./AttachmentUploader";
import { departmentApi, myProfileApi } from "@/lib/api";
import { DateInput } from "@/components/ui/DateInput";

export interface PostEditorValue {
  title: string;
  content: string;
  priority: number;
  expiresAt: string | null;
  attachmentIds: string[];
  targetDepartmentId?: string | null;
}

interface Props {
  initial?: Partial<PostEditorValue> & { attachments?: UploadedAttachment[] };
  onSubmit: (v: PostEditorValue) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
  /** 부서 선택 필드 표시 (부서 공지 보드에만 사용) */
  showTargetDepartment?: boolean;
}

interface DeptOption {
  id: string;
  name: string;
}

export default function PostEditor({ initial, onSubmit, onCancel, submitLabel = "발행", showTargetDepartment = false }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [priority, setPriority] = useState<number>(initial?.priority ?? 0);
  const [expiresAt, setExpiresAt] = useState<string>(initial?.expiresAt ? initial.expiresAt.slice(0, 10) : "");
  const [attachments, setAttachments] = useState<UploadedAttachment[]>(initial?.attachments ?? []);
  const [targetDeptId, setTargetDeptId] = useState<string>(initial?.targetDepartmentId ?? "");
  const [departments, setDepartments] = useState<DeptOption[]>([]);

  // 부서 선택 필드 표시 시: 부서 목록 + 본인 부서 기본값 로드
  useEffect(() => {
    if (!showTargetDepartment) return;
    let cancelled = false;
    (async () => {
      const [depts, profile] = await Promise.all([
        departmentApi.list().catch(() => []),
        myProfileApi.get().catch(() => null as any),
      ]);
      if (cancelled) return;
      // tree → flat
      const flatten = (nodes: any[]): DeptOption[] =>
        nodes.flatMap((n) => [{ id: n.id, name: n.name }, ...flatten(n.children ?? [])]);
      const flat = flatten((depts ?? []) as any[]).filter((d: any) => (d as any).isActive !== false);
      setDepartments(flat);
      // 기본값: initial 우선, 없으면 본인 부서
      if (!initial?.targetDepartmentId && profile?.profile?.departmentId) {
        setTargetDeptId(profile.profile.departmentId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showTargetDepartment, initial?.targetDepartmentId]);
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertAtCursor = (text: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setContent((prev) => prev + text);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setContent((prev) => prev.slice(0, start) + text + prev.slice(end));
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + text.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const handleAdd = (att: UploadedAttachment) => {
    setAttachments((prev) => [...prev, att]);
  };
  const handleRemove = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("제목을 입력해주세요.");
      return;
    }
    if (!content.trim()) {
      setError("본문을 입력해주세요.");
      return;
    }
    setSubmitting(true);
    try {
      const payload: PostEditorValue = {
        title: title.trim(),
        content,
        priority,
        expiresAt: expiresAt ? new Date(expiresAt + "T23:59:59").toISOString() : null,
        attachmentIds: attachments.map((a) => a.id),
      };
      if (showTargetDepartment) {
        payload.targetDepartmentId = targetDeptId || null;
      }
      await onSubmit(payload);
    } catch (err: any) {
      setError(err?.message ?? "저장 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목을 입력하세요"
          maxLength={200}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">우선순위</label>
          <select
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value={0}>일반</option>
            <option value={1}>중요</option>
            <option value={2}>긴급</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            만료일 <span className="text-xs text-gray-400">(선택)</span>
          </label>
          <DateInput
            
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      {showTargetDepartment && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            공지 대상 부서
            <span className="text-xs text-gray-400 ml-2">(미선택 시 전체)</span>
          </label>
          <select
            value={targetDeptId}
            onChange={(e) => setTargetDeptId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">— 전체 (부서 미지정) —</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-gray-700">본문 (Markdown 지원)</label>
          <div className="flex gap-1 text-xs">
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className={`px-2 py-1 rounded ${!showPreview ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100"}`}
            >
              편집
            </button>
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className={`px-2 py-1 rounded ${showPreview ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100"}`}
            >
              미리보기
            </button>
          </div>
        </div>
        {showPreview ? (
          <div className="border border-gray-300 rounded-lg px-4 py-3 min-h-[300px] bg-white">
            {content.trim() ? <PostMarkdownView content={content} /> : (
              <div className="text-sm text-gray-400">미리보기할 내용이 없습니다.</div>
            )}
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="# 제목\n\n본문을 입력하세요. Markdown(GFM)을 지원합니다."
            rows={14}
            maxLength={102400}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
            required
          />
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">첨부파일</label>
        <AttachmentUploader
          attachments={attachments}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onInsertImageMarkdown={insertAtCursor}
        />
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 border border-gray-300 rounded-lg py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "저장 중..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
