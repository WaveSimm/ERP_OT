/* ERP-OT PWA 서비스워커 — 보수적 캐싱 (실시간 데이터 안전 우선)
   - /api/* : 절대 캐시 안 함 (항상 네트워크). 근태·이슈 등 실시간성 보장.
   - 페이지 이동(navigate) : 네트워크 우선 → 실패 시 오프라인 폴백.
   - 정적 자산(/_next/static, /icons, 이미지) : 캐시 우선(운영은 해시 파일이라 안전).
   - dev/preview 포트(3010/3009) : next dev는 청크 URL이 고정(비해시)이라 cache-first가
     stale 코드를 계속 반환함 → 해당 포트에서는 SW를 자가 제거하고 개입하지 않는다.
   배포로 sw.js가 바뀌면 CACHE 버전을 올려 이전 캐시를 정리한다. */
const CACHE = "erp-ot-v2";
const OFFLINE_URL = "/offline.html";
const STATIC_PREFIXES = ["/_next/static/", "/icons/"];
// 개발·프리뷰 서버 포트에서는 SW를 쓰지 않는다(비해시 청크 stale 방지).
const IS_DEV = self.location.port === "3010" || self.location.port === "3009";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  if (IS_DEV) return;
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([OFFLINE_URL])).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if (IS_DEV) {
        // dev/preview: 모든 캐시 삭제 + SW 등록 해제 + 열린 창 새로고침 → 항상 최신 코드
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        await self.registration.unregister().catch(() => {});
        const clients = await self.clients.matchAll({ type: "window" });
        clients.forEach((c) => c.navigate(c.url));
        return;
      }
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (IS_DEV) return; // dev/preview: SW가 개입하지 않음(항상 네트워크)
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 실시간 데이터: API·프록시 경로는 캐시 금지
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/nas-file/")) return;

  // 페이지 이동: 네트워크 우선, 실패 시 오프라인 폴백
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error()))
    );
    return;
  }

  // 정적 자산: 캐시 우선(없으면 네트워크 후 캐시 저장)
  if (STATIC_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
      )
    );
  }
});
