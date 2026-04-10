"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface UndoableAction {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const MAX_STACK = 30;

export function useUndoRedo(opts?: { onError?: () => void; onAfterAction?: () => void }) {
  const undoStackRef = useRef<UndoableAction[]>([]);
  const redoStackRef = useRef<UndoableAction[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const onErrorRef = useRef(opts?.onError);
  onErrorRef.current = opts?.onError;
  const onAfterActionRef = useRef(opts?.onAfterAction);
  onAfterActionRef.current = opts?.onAfterAction;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), 2000);
  }, []);

  const push = useCallback((action: UndoableAction) => {
    undoStackRef.current.push(action);
    if (undoStackRef.current.length > MAX_STACK) undoStackRef.current.shift();
    redoStackRef.current = [];
    const newCount = undoStackRef.current.length;
    console.log("[UndoRedo] push:", action.label, "stack size:", newCount);
    setUndoCount(newCount);
    setRedoCount(0);
  }, []);

  const undo = useCallback(async () => {
    const action = undoStackRef.current.pop();
    if (!action) return;
    try {
      await action.undo();
      redoStackRef.current.push(action);
      showToast(`↩ 실행취소: ${action.label}`);
      onAfterActionRef.current?.();
    } catch {
      onErrorRef.current?.();
    }
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
  }, [showToast]);

  const redo = useCallback(async () => {
    const action = redoStackRef.current.pop();
    if (!action) return;
    try {
      await action.redo();
      undoStackRef.current.push(action);
      showToast(`↪ 다시실행: ${action.label}`);
      onAfterActionRef.current?.();
    } catch {
      onErrorRef.current?.();
    }
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
  }, [showToast]);

  const undoLabel = undoStackRef.current[undoStackRef.current.length - 1]?.label ?? null;
  const redoLabel = redoStackRef.current[redoStackRef.current.length - 1]?.label ?? null;

  // Keyboard: Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.ctrlKey && !e.shiftKey && e.key === "z") { e.preventDefault(); undo(); }
      if (e.ctrlKey && e.key === "y") { e.preventDefault(); redo(); }
      if (e.ctrlKey && e.shiftKey && e.key === "Z") { e.preventDefault(); redo(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [undo, redo]);

  return { push, undo, redo, undoCount, redoCount, undoLabel, redoLabel, toast };
}
