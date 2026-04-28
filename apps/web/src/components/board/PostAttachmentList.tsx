"use client";

import { attachmentApi } from "@/lib/api";

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

function fileIcon(mime: string) {
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf") return "📄";
  if (mime.includes("spreadsheetml") || mime === "text/csv" || mime === "application/vnd.ms-excel") return "📊";
  if (mime.includes("wordprocessingml") || mime === "application/msword") return "📝";
  if (mime.includes("presentationml") || mime === "application/vnd.ms-powerpoint") return "📑";
  return "📎";
}

export default function PostAttachmentList({ attachments }: { attachments: AttachmentItem[] }) {
  // 인라인 이미지(본문 안에서 표시되는 것)는 첨부 영역에서 제외
  const visible = attachments.filter((a) => !a.isInline);
  if (visible.length === 0) return null;

  return (
    <div className="border-t border-gray-200 pt-3 mt-4">
      <div className="text-xs font-semibold text-gray-500 mb-2">📎 첨부파일 ({visible.length})</div>
      <div className="space-y-1">
        {visible.map((a) => (
          <a
            key={a.id}
            href={attachmentApi.downloadUrl(a.id)}
            download={a.fileName}
            className="flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg text-sm"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>{fileIcon(a.mimeType)}</span>
            <span className="flex-1 truncate text-gray-800">{a.fileName}</span>
            <span className="text-xs text-gray-400">{formatSize(a.fileSize)}</span>
            <span className="text-xs text-blue-600 font-medium">다운로드</span>
          </a>
        ))}
      </div>
    </div>
  );
}
