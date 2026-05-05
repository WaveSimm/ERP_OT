"use client";

import { useState, useRef, DragEvent } from "react";
import { attachmentApi } from "@/lib/api";
import { compressImage } from "@/lib/image-compress";

export interface UploadedAttachment {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  isInline: boolean;
  url: string;
}

interface Props {
  attachments: UploadedAttachment[];
  onAdd: (att: UploadedAttachment) => void;
  onRemove: (id: string) => void;
  onInsertImageMarkdown?: (markdown: string) => void;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function fileIcon(mime: string) {
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf") return "📄";
  if (mime.includes("spreadsheet") || mime === "text/csv" || mime === "application/vnd.ms-excel") return "📊";
  if (mime.includes("wordprocessing") || mime === "application/msword") return "📝";
  if (mime.includes("presentation") || mime === "application/vnd.ms-powerpoint") return "📑";
  return "📎";
}

export default function AttachmentUploader({ attachments, onAdd, onRemove, onInsertImageMarkdown }: Props) {
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      for (const raw of Array.from(files)) {
        // 수리관리 v2.2: 이미지 자동 리사이즈 (1920px / JPEG 0.85)
        const file = await compressImage(raw);
        const isInline = file.type.startsWith("image/");
        const att = await attachmentApi.upload(file, isInline);
        onAdd(att);
        if (isInline && onInsertImageMarkdown) {
          onInsertImageMarkdown(`![${att.fileName}](${att.url})\n`);
        }
      }
    } catch (err: any) {
      setError(err?.message ?? "업로드 실패");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    void handleFiles(e.dataTransfer.files);
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
          dragActive ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-gray-50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
            <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full" />
            업로드 중...
          </div>
        ) : (
          <div className="text-sm text-gray-500">
            📎 파일을 드래그하거나 클릭하여 추가 <span className="text-xs text-gray-400">(이미지는 본문에 자동 삽입 · 1920px / 약 500KB로 자동 압축)</span>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {attachments.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg text-sm"
            >
              <span>{fileIcon(a.mimeType)}</span>
              <span className="flex-1 truncate text-gray-800">{a.fileName}</span>
              <span className="text-xs text-gray-400">{formatSize(a.fileSize)}</span>
              {a.isInline && (
                <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">인라인</span>
              )}
              <button
                type="button"
                onClick={() => onRemove(a.id)}
                className="text-gray-400 hover:text-red-600 text-sm"
                title="제거"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
