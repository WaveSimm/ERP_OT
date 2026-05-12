"use client";

import { useEffect, useRef, useState } from "react";
import { expenseApi } from "@/lib/api";

interface Region {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  receiptId: string;
  onClose: () => void;
  onSuccess: (createdCount: number) => void;
}

// 사용자가 마우스 드래그로 사각형 영역을 그려 영수증을 N개로 분할.
// 좌표는 0-1 normalized (이미지 크기 무관).
export default function ReceiptSplitModal({ receiptId, onClose, onSuccess }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [drawing, setDrawing] = useState<Region | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const nextIdRef = useRef(1);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  function getRelativePos(e: React.PointerEvent): { x: number; y: number } | null {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest(".region-marker")) return;
    const p = getRelativePos(e);
    if (!p) return;
    e.preventDefault();
    setDrawing({ id: nextIdRef.current++, x: p.x, y: p.y, width: 0, height: 0 });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drawing) return;
    const p = getRelativePos(e);
    if (!p) return;
    setDrawing((cur) => {
      if (!cur) return cur;
      const x0 = Math.min(cur.x, p.x);
      const y0 = Math.min(cur.y, p.y);
      const x1 = Math.max(cur.x, p.x);
      const y1 = Math.max(cur.y, p.y);
      return { ...cur, x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    });
  }

  function onPointerUp() {
    if (!drawing) return;
    if (drawing.width > 0.02 && drawing.height > 0.02) {
      setRegions((prev) => [...prev, drawing]);
    }
    setDrawing(null);
  }

  function removeRegion(id: number) {
    setRegions((prev) => prev.filter((r) => r.id !== id));
  }

  async function submit() {
    if (regions.length === 0) {
      alert("최소 1개 영역을 그려주세요.");
      return;
    }
    setSubmitting(true);
    try {
      const data = await expenseApi.splitReceipt(
        receiptId,
        regions.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
      );
      onSuccess(data.created.length);
    } catch (e: any) {
      alert("분할 실패: " + (e.message ?? e));
    } finally {
      setSubmitting(false);
    }
  }

  const allRegions = drawing ? [...regions, drawing] : regions;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[95vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-bold">영수증 영역 분할</h2>
            <p className="text-xs text-gray-500">
              마우스 드래그로 각 영수증 영역을 사각형으로 그리세요. 영역의 ✕ 버튼으로 삭제.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700" title="ESC">✕</button>
        </div>

        <div className="flex-1 overflow-auto p-4 bg-gray-100">
          <div
            ref={containerRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            className="relative inline-block select-none"
            style={{ cursor: "crosshair", touchAction: "none" }}
          >
            <img
              src={expenseApi.receiptDownloadUrl(receiptId)}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
              }}
              className="block max-w-full max-h-[70vh] pointer-events-none"
            />
            {allRegions.map((r, idx) => (
              <div key={r.id}
                className="region-marker absolute border-2 border-red-500 bg-red-500/10 pointer-events-none"
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.width * 100}%`,
                  height: `${r.height * 100}%`,
                }}>
                <span className="absolute top-0 left-0 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-br">
                  #{idx + 1}
                </span>
                {r !== drawing && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeRegion(r.id); }}
                    className="region-marker absolute top-0 right-0 bg-red-500 text-white text-xs w-5 h-5 rounded-bl pointer-events-auto"
                    title="이 영역 삭제">
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 border-t bg-white">
          <span className="text-sm">
            <strong>{regions.length}</strong>개 영역
          </span>
          {naturalSize && (
            <span className="text-xs text-gray-500">
              원본 {naturalSize.w}×{naturalSize.h}
            </span>
          )}
          <button onClick={() => setRegions([])} disabled={regions.length === 0}
            className="text-sm text-gray-500 hover:text-gray-700 underline disabled:opacity-40">
            모두 지우기
          </button>
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} className="px-4 py-1.5 rounded border text-sm">취소</button>
            <button onClick={submit} disabled={submitting || regions.length === 0}
              className="px-5 py-1.5 rounded text-sm enabled:bg-blue-600 enabled:text-white enabled:hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400">
              {submitting ? "분할 중..." : `${regions.length}개로 분할`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
