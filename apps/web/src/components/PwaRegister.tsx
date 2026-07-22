"use client";

import { useEffect } from "react";

// 서비스워커 등록 — HTTPS(또는 localhost) 보안 컨텍스트에서만 동작.
// HTTP(예: LAN IP)에서는 브라우저가 등록을 막으므로 조용히 무시된다.
export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (!window.isSecureContext) return; // HTTP면 등록 시도 안 함
    // 개발·프리뷰 서버(next dev)는 청크 URL이 고정(비해시)이라 SW 캐시가 stale를 유발 →
    //   dev/preview 포트에서는 등록하지 않고, 이미 등록된 것은 해제한다.
    const isDevPort = ["3010", "3009"].includes(window.location.port);
    if (process.env.NODE_ENV !== "production" || isDevPort) {
      navigator.serviceWorker.getRegistrations()
        .then((rs) => rs.forEach((r) => r.unregister()))
        .catch(() => {});
      return;
    }
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}
