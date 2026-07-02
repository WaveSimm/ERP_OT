import { useEffect, useRef, useState } from "react";

/**
 * 표(또는 목록) 박스가 화면의 남은 높이를 채우게 실측 계산.
 * ref를 박스에 달면, 박스 top→화면 끝까지를 maxHeight로 돌려줌 → 페이지 스크롤 없이 박스 안에서만 스크롤.
 * @param bottomGap 박스 아래(페이지네이션 등) 여백 px. 기본 80.
 */
export function useFillHeight<T extends HTMLElement = HTMLDivElement>(bottomGap = 80) {
  const ref = useRef<T>(null);
  const [maxHeight, setMaxHeight] = useState<number>();
  useEffect(() => {
    const compute = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setMaxHeight(Math.max(220, window.innerHeight - top - bottomGap));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(document.body);
    window.addEventListener("resize", compute);
    return () => { ro.disconnect(); window.removeEventListener("resize", compute); };
  }, [bottomGap]);
  return { ref, maxHeight };
}
