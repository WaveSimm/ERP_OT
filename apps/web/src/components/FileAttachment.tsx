"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { fileApi } from "@/lib/api";

interface FileAttachmentProps {
  referenceType: string;
  referenceId: string;
  readOnly?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FILE_ICONS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/jpg": "JPG",
  "image/png": "PNG",
  "image/webp": "WEBP",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
};

export default function FileAttachment({ referenceType, referenceId, readOnly }: FileAttachmentProps) {
  const [files, setFiles] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    try {
      const list = await fileApi.list(referenceType, referenceId);
      setFiles(Array.isArray(list) ? list : []);
    } catch {
      setFiles([]);
    }
  }, [referenceType, referenceId]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        if (file.size > 10 * 1024 * 1024) {
          alert(`${file.name}: 10MB 이하 파일만 업로드 가능합니다.`);
          continue;
        }
        await fileApi.upload(referenceType, referenceId, file);
      }
      await loadFiles();
    } catch (e: any) {
      alert(e.message || "업로드 실패");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDownload = async (file: any) => {
    try {
      const res = await fileApi.download(file.id);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("다운로드 실패");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("첨부파일을 삭제하시겠습니까?")) return;
    try {
      await fileApi.remove(id);
      await loadFiles();
    } catch {
      alert("삭제 실패");
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!readOnly) handleUpload(e.dataTransfer.files);
  };

  return (
    <div className="space-y-2">
      {/* 업로드 영역 */}
      {!readOnly && (
        <div
          className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${
            dragOver ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-gray-400"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
            accept="image/*,application/pdf,.xlsx,.xls,.docx,.doc"
          />
          {uploading ? (
            <p className="text-sm text-blue-600 dark:text-blue-400">업로드 중...</p>
          ) : (
            <div>
              <p className="text-sm text-gray-500">파일을 드래그하거나 클릭하여 첨부</p>
              <p className="text-xs text-gray-400 mt-1">이미지는 자동 최적화됩니다 (최대 10MB)</p>
            </div>
          )}
        </div>
      )}

      {/* 파일 목록 */}
      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-2 bg-white border rounded-lg px-3 py-2 group">
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 shrink-0">
                {FILE_ICONS[f.mimeType] || f.mimeType.split("/")[1]?.toUpperCase()?.slice(0, 4) || "FILE"}
              </span>
              <button
                onClick={() => handleDownload(f)}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate text-left flex-1"
                title={f.fileName}
              >
                {f.fileName}
              </button>
              <span className="text-xs text-gray-400 shrink-0">{formatFileSize(f.fileSize)}</span>
              {!readOnly && (
                <button
                  onClick={() => handleDelete(f.id)}
                  className="text-red-400 hover:text-red-600 text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  삭제
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {files.length === 0 && readOnly && (
        <p className="text-xs text-gray-400">첨부파일이 없습니다.</p>
      )}
    </div>
  );
}
