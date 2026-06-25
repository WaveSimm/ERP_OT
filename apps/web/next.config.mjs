/** @type {import('next').NextConfig} */
// 보안 일괄패치 PDCA Layer 5 (FR-31): 보안 헤더 5종
//   HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy
//   CSP는 Report-Only로 시작 (2-3일 모니터링 후 정식 — Design v1.1)
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // CSP enforce (2026-06-20 강제 전환, 배치B V-17). unsafe-inline/eval은 web dev 모드 호환 위해 유지
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; " +
      "connect-src 'self' http://localhost:* ws://localhost:*; " +
      "frame-ancestors 'none'",
  },
];

const nextConfig = {
  // output: "standalone" 제거 — `next start`로 구동(standalone server.js 미사용).
  //   standalone 출력이 /404·/500 prerender 시 <Html> import 오류를 유발해 제거.
  // missingSuspenseWithCSRBailout: true(기본) — useSearchParams를 Suspense 없이 쓰는 페이지를
  //   자동으로 CSR 폴백시켜 정적 prerender 시 useContext null 오류를 회피.
  //   (false로 두면 폴백이 막혀 거의 모든 클라이언트 페이지가 prerender 실패함)
  experimental: {
    missingSuspenseWithCSRBailout: true,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    const eq = process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005";
    const auth = process.env.AUTH_SERVICE_URL || "http://localhost:3001";
    const att = process.env.ATTENDANCE_SERVICE_URL || "http://localhost:3004";
    const proj = process.env.API_BASE_URL || "http://localhost:3003";
    const appr = process.env.APPROVAL_SERVICE_URL || "http://localhost:3006";
    const ocr = process.env.OCR_SERVICE_URL || "http://localhost:3007";
    const exp = process.env.EXPENSE_SERVICE_URL || "http://localhost:3008";
    // OT-Brain knowledge-api (NAS 통합검색) — 호스트 서비스(GPU reranker 동반). 컨테이너에선 host.docker.internal 경유.
    const knowledge = process.env.KNOWLEDGE_SERVICE_URL || "http://ot-knowledge-api:3100";
    const nasFile = process.env.NAS_FILE_SERVICE_URL || "http://ot-nas-file:3105";

    return [
      // ── OT-Brain knowledge-api (NAS 통합검색) — /api/v1/knowledge/* → knowledge-api /api/v1/* ──
      { source: "/api/v1/knowledge/:path*", destination: `${knowledge}/api/v1/:path*` },
      // ── NAS 파일 서빙 (검색결과 파일 열기/다운로드) — /nas-file/* → ot-nas-file:3105 ──
      //    브라우저는 same-origin(/nas-file)으로 호출 → web 이 프록시(3105 LAN 미노출).
      { source: "/nas-file/:path*", destination: `${nasFile}/:path*` },
      // ── expense-service (경비정산 V2) ──
      { source: "/api/v1/expense/:path*", destination: `${exp}/api/v1/expense/:path*` },

      // ── ocr-service (OCR 문서인식) ──
      { source: "/api/v1/ocr/:path*", destination: `${ocr}/api/v1/ocr/:path*` },

      // ── equipment-service (장비/수리/구매/재고) ──
      { source: "/api/v1/equipment", destination: `${eq}/api/v1/equipment` },
      { source: "/api/v1/equipment/:path*", destination: `${eq}/api/v1/equipment/:path*` },
      { source: "/api/v1/sensors", destination: `${eq}/api/v1/sensors` },
      { source: "/api/v1/sensors/:path*", destination: `${eq}/api/v1/sensors/:path*` },
      { source: "/api/v1/categories", destination: `${eq}/api/v1/categories` },
      { source: "/api/v1/categories/:path*", destination: `${eq}/api/v1/categories/:path*` },
      { source: "/api/v1/maintenance", destination: `${eq}/api/v1/maintenance` },
      { source: "/api/v1/maintenance/:path*", destination: `${eq}/api/v1/maintenance/:path*` },
      { source: "/api/v1/schedules", destination: `${eq}/api/v1/schedules` },
      { source: "/api/v1/schedules/:path*", destination: `${eq}/api/v1/schedules/:path*` },
      { source: "/api/v1/deployments", destination: `${eq}/api/v1/deployments` },
      { source: "/api/v1/deployments/:path*", destination: `${eq}/api/v1/deployments/:path*` },
      { source: "/api/v1/compatibility", destination: `${eq}/api/v1/compatibility` },
      { source: "/api/v1/compatibility/:path*", destination: `${eq}/api/v1/compatibility/:path*` },
      // 수리관리
      { source: "/api/v1/customers", destination: `${eq}/api/v1/customers` },
      { source: "/api/v1/customers/:path*", destination: `${eq}/api/v1/customers/:path*` },
      { source: "/api/v1/customer-assets", destination: `${eq}/api/v1/customer-assets` },
      { source: "/api/v1/customer-assets/:path*", destination: `${eq}/api/v1/customer-assets/:path*` },
      { source: "/api/v1/repair-orders", destination: `${eq}/api/v1/repair-orders` },
      { source: "/api/v1/repair-orders/:path*", destination: `${eq}/api/v1/repair-orders/:path*` },
      { source: "/api/v1/inspection-reports", destination: `${eq}/api/v1/inspection-reports` },
      { source: "/api/v1/inspection-reports/:path*", destination: `${eq}/api/v1/inspection-reports/:path*` },
      { source: "/api/v1/repair-costs", destination: `${eq}/api/v1/repair-costs` },
      { source: "/api/v1/repair-costs/:path*", destination: `${eq}/api/v1/repair-costs/:path*` },
      { source: "/api/v1/repair-quotes", destination: `${eq}/api/v1/repair-quotes` },
      { source: "/api/v1/repair-quotes/:path*", destination: `${eq}/api/v1/repair-quotes/:path*` },
      { source: "/api/v1/parts", destination: `${eq}/api/v1/parts` },
      { source: "/api/v1/parts/:path*", destination: `${eq}/api/v1/parts/:path*` },
      { source: "/api/v1/part-transactions", destination: `${eq}/api/v1/part-transactions` },
      { source: "/api/v1/part-transactions/:path*", destination: `${eq}/api/v1/part-transactions/:path*` },
      { source: "/api/v1/purchase-orders", destination: `${eq}/api/v1/purchase-orders` },
      { source: "/api/v1/purchase-orders/:path*", destination: `${eq}/api/v1/purchase-orders/:path*` },
      { source: "/api/v1/shipments", destination: `${eq}/api/v1/shipments` },
      { source: "/api/v1/shipments/:path*", destination: `${eq}/api/v1/shipments/:path*` },
      { source: "/api/v1/repair-stats/:path*", destination: `${eq}/api/v1/repair-stats/:path*` },
      // 제조사/공급사
      { source: "/api/v1/suppliers", destination: `${eq}/api/v1/suppliers` },
      { source: "/api/v1/suppliers/:path*", destination: `${eq}/api/v1/suppliers/:path*` },
      // 구매/재고 (신규)
      { source: "/api/v1/procurement/:path*", destination: `${eq}/api/v1/procurement/:path*` },
      { source: "/api/v1/inventory/:path*", destination: `${eq}/api/v1/inventory/:path*` },
      // v1.6 SKU 모델 (2026-05-13)
      { source: "/api/v1/product-variants", destination: `${eq}/api/v1/product-variants` },
      { source: "/api/v1/product-variants/:path*", destination: `${eq}/api/v1/product-variants/:path*` },
      { source: "/api/v1/inbound-requests", destination: `${eq}/api/v1/inbound-requests` },
      { source: "/api/v1/inbound-requests/:path*", destination: `${eq}/api/v1/inbound-requests/:path*` },
      // bom-definitions 폐기 (v1.6 B안, 2026-05-13). ProductMaster(BUNDLE)로 통합.
      { source: "/api/v1/bundle-shipments", destination: `${eq}/api/v1/bundle-shipments` },
      { source: "/api/v1/bundle-shipments/:path*", destination: `${eq}/api/v1/bundle-shipments/:path*` },

      // ── auth-service ──
      { source: "/api/v1/auth", destination: `${auth}/api/v1/auth` },
      { source: "/api/v1/auth/:path*", destination: `${auth}/api/v1/auth/:path*` },
      { source: "/api/v1/users", destination: `${auth}/api/v1/users` },
      { source: "/api/v1/users/:path*", destination: `${auth}/api/v1/users/:path*` },
      { source: "/api/v1/departments", destination: `${auth}/api/v1/departments` },
      { source: "/api/v1/departments/:path*", destination: `${auth}/api/v1/departments/:path*` },
      { source: "/api/v1/approval-lines", destination: `${auth}/api/v1/approval-lines` },
      { source: "/api/v1/approval-lines/:path*", destination: `${auth}/api/v1/approval-lines/:path*` },
      // 회사 달력 (auth-service 확장)
      { source: "/api/v1/calendar", destination: `${auth}/api/v1/calendar` },
      { source: "/api/v1/calendar/:path*", destination: `${auth}/api/v1/calendar/:path*` },
      // 자연어 검색 (auth-service)
      { source: "/api/v1/search", destination: `${auth}/api/v1/search` },
      // 게시판 도메인 (auth-service 확장)
      { source: "/api/v1/board-categories", destination: `${auth}/api/v1/board-categories` },
      { source: "/api/v1/board-categories/:path*", destination: `${auth}/api/v1/board-categories/:path*` },
      { source: "/api/v1/boards", destination: `${auth}/api/v1/boards` },
      { source: "/api/v1/boards/:path*", destination: `${auth}/api/v1/boards/:path*` },
      { source: "/api/v1/posts", destination: `${auth}/api/v1/posts` },
      { source: "/api/v1/posts/:path*", destination: `${auth}/api/v1/posts/:path*` },
      { source: "/api/v1/comments", destination: `${auth}/api/v1/comments` },
      { source: "/api/v1/comments/:path*", destination: `${auth}/api/v1/comments/:path*` },
      { source: "/api/v1/attachments", destination: `${auth}/api/v1/attachments` },
      { source: "/api/v1/attachments/:path*", destination: `${auth}/api/v1/attachments/:path*` },
      // 게시판 design v2.0 (2026-05-22): 기능 요구 관리
      { source: "/api/v1/feature-requests", destination: `${auth}/api/v1/feature-requests` },
      { source: "/api/v1/feature-requests/:path*", destination: `${auth}/api/v1/feature-requests/:path*` },

      // 작업비고 (WorkLog) — project-service
      { source: "/api/v1/work-logs", destination: `${proj}/api/v1/work-logs` },
      { source: "/api/v1/work-logs/:path*", destination: `${proj}/api/v1/work-logs/:path*` },
      { source: "/api/v1/me/work-logs", destination: `${proj}/api/v1/me/work-logs` },
      { source: "/api/v1/me/work-log-projects", destination: `${proj}/api/v1/me/work-log-projects` },
      { source: "/api/v1/me/work-log-feed", destination: `${proj}/api/v1/me/work-log-feed` },

      // ── attendance-service ──
      { source: "/api/v1/attendance/:path*", destination: `${att}/api/v1/attendance/:path*` },
      { source: "/api/v1/leave/:path*", destination: `${att}/api/v1/leave/:path*` },
      { source: "/api/v1/holiday-work/:path*", destination: `${att}/api/v1/holiday-work/:path*` },
      { source: "/api/v1/policy/:path*", destination: `${att}/api/v1/policy/:path*` },
      { source: "/api/v1/team/:path*", destination: `${att}/api/v1/team/:path*` },
      { source: "/api/v1/notifications", destination: `${att}/api/v1/notifications` },
      { source: "/api/v1/notifications/:path*", destination: `${att}/api/v1/notifications/:path*` },
      { source: "/api/v1/work-schedule", destination: `${att}/api/v1/work-schedule` },
      { source: "/api/v1/work-schedule/:path*", destination: `${att}/api/v1/work-schedule/:path*` },

      // ── approval-service ──
      { source: "/api/v1/approval/:path*", destination: `${appr}/api/v1/approval/:path*` },

      // ── project-service (catch-all, 반드시 마지막) ──
      { source: "/api/v1/:path*", destination: `${proj}/api/v1/:path*` },
    ];
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    return config;
  },
};

export default nextConfig;
