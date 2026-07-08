import { useRef, useEffect } from "react";

/**
 * 드래그(HTML5 네이티브) 중 가장자리 근처에서 스크롤 컨테이너를 자동으로 밀어주는 훅.
 * 네이티브 드래그는 auto-scroll을 안 해줘서, 리스트가 길면 화면 밖(위/아래) 항목까지 못 감 → rAF 루프로 보완.
 * dragend/drop 을 window에서 감지해 자동으로 멈추므로, 드롭 없이 취소해도 스크롤이 계속되지 않음.
 *
 * @param opts.getContainer 스크롤 대상 엘리먼트 반환(없으면 window 스크롤)
 * @param opts.topOffset    window 스크롤 시 상단 고정 헤더 높이(px). 헤더 아래부터 감지.
 * @param opts.edge         가장자리 감지 폭(px, 기본 70)
 * @param opts.maxSpeed     프레임당 최대 스크롤(px, 기본 22)
 *
 * 사용: const { start, stop } = useDragAutoScroll({ ... });
 *       onDragStart 에서 start(e.clientY) 호출. (stop 은 자동 — 필요 시 수동 호출도 가능)
 */
export function useDragAutoScroll(opts?: {
  getContainer?: () => HTMLElement | null;
  topOffset?: number;
  edge?: number;
  maxSpeed?: number;
}) {
  // opts 는 렌더마다 새 객체 → ref로 최신값 유지 (start/tick 에서 최신 참조)
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // start/stop 은 한 번만 생성(안정 참조) → add/removeEventListener 짝 유지
  const api = useRef<{ start: (clientY?: number) => void; stop: () => void }>();
  if (!api.current) {
    let raf = 0;
    let pointerY = 0;
    const onWinDragOver = (e: DragEvent) => { pointerY = e.clientY; };

    const stop = () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      window.removeEventListener("dragover", onWinDragOver);
      window.removeEventListener("dragend", stop);
      window.removeEventListener("drop", stop);
    };

    const start = (clientY?: number) => {
      if (typeof clientY === "number") pointerY = clientY;
      window.addEventListener("dragover", onWinDragOver);
      window.addEventListener("dragend", stop);
      window.addEventListener("drop", stop);
      const tick = () => {
        const o = optsRef.current;
        const EDGE = o?.edge ?? 70;
        const MAX = o?.maxSpeed ?? 22;
        const y = pointerY;
        const el = o?.getContainer?.() ?? null;
        if (el) {
          const r = el.getBoundingClientRect();
          const top = r.top + EDGE;
          const bottom = r.bottom - EDGE;
          if (y > r.top && y < top) el.scrollBy(0, -Math.ceil(MAX * Math.min(1, (top - y) / EDGE)));
          else if (y < r.bottom && y > bottom) el.scrollBy(0, Math.ceil(MAX * Math.min(1, (y - bottom) / EDGE)));
        } else {
          const top = (o?.topOffset ?? 0) + EDGE;
          const bottom = window.innerHeight - EDGE;
          if (y > 0 && y < top) window.scrollBy(0, -Math.ceil(MAX * Math.min(1, (top - y) / EDGE)));
          else if (y > bottom) window.scrollBy(0, Math.ceil(MAX * Math.min(1, (y - bottom) / EDGE)));
        }
        raf = requestAnimationFrame(tick);
      };
      if (!raf) raf = requestAnimationFrame(tick);
    };

    api.current = { start, stop };
  }

  useEffect(() => api.current!.stop, []);  // 언마운트 정리
  return api.current;
}
