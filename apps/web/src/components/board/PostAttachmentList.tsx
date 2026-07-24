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

type FitMode = "FitH" | "Fit"; // FitH=폭 맞춤(크게), Fit=전체 페이지(한눈에)

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function isPdf(a: AttachmentItem) {
  return a.mimeType === "application/pdf" || a.fileName.toLowerCase().endsWith(".pdf");
}

/** 다운로드 링크(카드) — 비-PDF 첨부 및 모바일 PDF 분기용 */
function DownloadRow({ a }: { a: AttachmentItem }) {
  return (
    <a
      href={attachmentApi.downloadUrl(a.id)}
      download={a.fileName}
      className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-sm"
      target="_blank"
      rel="noopener noreferrer"
    >
      <span><FileIcon /></span>
      <span className="flex-1 truncate text-gray-800 dark:text-gray-200">{a.fileName}</span>
      <span className="text-xs text-gray-400">{formatSize(a.fileSize)}</span>
      <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">다운로드</span>
    </a>
  );
}

export default function PostAttachmentList({ attachments }: { attachments: AttachmentItem[] }) {
  // 서버가 PDF를 inline(Content-Disposition)으로 서빙하므로 iframe에 바로 렌더된다.
  // 모바일은 iframe 내 PDF가 빈 화면으로 뜨는 경우가 있어 미리보기 대신 다운로드만 노출.
  const [isMobile, setIsMobile] = useState(false);
  // PDF별 맞춤 모드 (기본 전체 페이지). 전환 시 iframe을 key로 리마운트해 확실히 다시 맞춘다.
  const [fit, setFit] = useState<Record<string, FitMode>>({});

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // 인라인 이미지(본문 안에서 표시되는 것)는 첨부 영역에서 제외
  const visible = attachments.filter((a) => !a.isInline);
  if (visible.length === 0) return null;

  const modeOf = (id: string): FitMode => fit[id] ?? "Fit";
  const setMode = (id: string, m: FitMode) => setFit((prev) => ({ ...prev, [id]: m }));

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-4">
      <div className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 mb-2"><PaperclipIcon /> 첨부파일 ({visible.length})</div>
      <div className="space-y-2">
        {visible.map((a) => {
          if (!(isPdf(a) && !isMobile)) return <DownloadRow key={a.id} a={a} />;
          const mode = modeOf(a.id);
          return (
            <div key={a.id} className="max-w-[1400px] mx-auto rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 text-sm">
                <span><FileIcon /></span>
                <span className="flex-1 truncate text-gray-800 dark:text-gray-200">{a.fileName}</span>
                {/* 폭 맞춤 ↔ 전체 페이지 토글 */}
                <div className="inline-flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden text-[11px] font-medium">
                  <button
                    type="button"
                    onClick={() => setMode(a.id, "FitH")}
                    className={`px-2 py-0.5 ${mode === "FitH" ? "bg-blue-600 text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
                  >
                    폭 맞춤
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode(a.id, "Fit")}
                    className={`px-2 py-0.5 border-l border-gray-300 dark:border-gray-600 ${mode === "Fit" ? "bg-blue-600 text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
                  >
                    전체
                  </button>
                </div>
                <span className="text-xs text-gray-400">{formatSize(a.fileSize)}</span>
                <a
                  href={attachmentApi.downloadUrl(a.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 dark:text-blue-400 font-medium hover:underline"
                >
                  새 탭에서 열기
                </a>
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
              <iframe
                key={`${a.id}-${mode}`}
                src={`${attachmentApi.downloadUrl(a.id)}#view=${mode}`}
                title={a.fileName}
                className="w-full h-[80vh] bg-white"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
