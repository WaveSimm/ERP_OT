"use client";

interface Props {
  undoCount: number;
  redoCount: number;
  undoLabel: string | null;
  redoLabel: string | null;
  toast: string | null;
  onUndo: () => void;
  onRedo: () => void;
}

export default function UndoRedoControls({ undoCount, redoCount, undoLabel, redoLabel, toast, onUndo, onRedo }: Props) {
  return (
    <>
      {/* Buttons */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={onUndo}
          disabled={undoCount === 0}
          className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          title={`실행취소 (Ctrl+Z)${undoLabel ? ` · ${undoLabel}` : ""}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        </button>
        <button
          onClick={onRedo}
          disabled={redoCount === 0}
          className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          title={`다시실행 (Ctrl+Y)${redoLabel ? ` · ${redoLabel}` : ""}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
