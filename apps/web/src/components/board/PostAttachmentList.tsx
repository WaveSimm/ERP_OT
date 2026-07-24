"use client";

import { useEffect, useState } from "react";
import { attachmentApi } from "@/lib/api";
import { PaperclipIcon, FileIcon } from "@/components/ui/icons";

export interface AttachmentItem {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  isInline: boolean;
  url: string;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function isPdf(a: AttachmentItem) {
  return a.mimeType === "application/pdf" || a.fileName.toLowerCase().endsWith(".pdf");
}

export default function PostAttachmentList({ attachments }: { attachments: AttachmentItem[] }) {
  // 모바일은 iframe 내 PDF가 빈 화면으로 뜨는 경우가 있어 미리보기 대신 다운로드만 노출.
  const [isMobile, setIsMobile] = useState(false);
  // 클릭 시 크게 띄우는 모달 대상 (null이면 닫힘)
  const [preview, setPreview] = useState<AttachmentItem | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  // 인라인 이미지(본문 안에서 표시되는 것)는 첨부 영역에서 제외
  const visible = attachments.filter((a) => !a.isInline);
  if (visible.length === 0) return null;

  const canPreview = (a: AttachmentItem) => isPdf(a) && !isMobile;

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-4">
      <div className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 mb-2"><PaperclipIcon /> 첨부파일 ({visible.length})</div>
      <div className="space-y-1">
        {visible.map((a) => (
          <div
            key={a.id}
            className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm"
          >
            <span><FileIcon /></span>
            <span className="flex-1 truncate text-gray-800 dark:text-gray-200">{a.fileName}</span>
            <span className="text-xs text-gray-400">{formatSize(a.fileSize)}</span>
            {canPreview(a) && (
              <button
                type="button"
                onClick={() => setPreview(a)}
                className="text-xs text-blue-600 dark:text-blue-400 font-medium hover:underline"
              >
                미리보기
              </button>
            )}
            <a
              href={attachmentApi.downloadUrl(a.id)}
              download={a.fileName}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-500 dark:text-gray-400 font-medium hover:underline"
            >
              다운로드
            </a>
          </div>
        ))}
      </div>

      {preview && (
        <div
          onClick={() => setPreview(null)}
          className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4 sm:p-8"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col flex-1 w-full max-w-5xl mx-auto bg-white dark:bg-gray-900 rounded-lg overflow-hidden shadow-xl"
          >
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
              <span><FileIcon /></span>
              <span className="flex-1 truncate text-sm font-medium text-gray-800 dark:text-gray-200">{preview.fileName}</span>
              <a
                href={attachmentApi.downloadUrl(preview.id)}
                download={preview.fileName}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 dark:text-blue-400 font-medium hover:underline"
              >
                다운로드
              </a>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="ml-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none"
                title="닫기 (Esc)"
              >
                ×
              </button>
            </div>
            <iframe
              src={attachmentApi.downloadUrl(preview.id)}
              title={preview.fileName}
              className="flex-1 w-full bg-white"
            />
          </div>
        </div>
      )}
    </div>
  );
}
