/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    const eq = process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005";
    const auth = process.env.AUTH_SERVICE_URL || "http://localhost:3001";
    const att = process.env.ATTENDANCE_SERVICE_URL || "http://localhost:3004";
    const proj = process.env.API_BASE_URL || "http://localhost:3003";
    const appr = process.env.APPROVAL_SERVICE_URL || "http://localhost:3006";

    return [
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

      // ── auth-service ──
      { source: "/api/v1/auth", destination: `${auth}/api/v1/auth` },
      { source: "/api/v1/auth/:path*", destination: `${auth}/api/v1/auth/:path*` },
      { source: "/api/v1/users", destination: `${auth}/api/v1/users` },
      { source: "/api/v1/users/:path*", destination: `${auth}/api/v1/users/:path*` },
      { source: "/api/v1/departments", destination: `${auth}/api/v1/departments` },
      { source: "/api/v1/departments/:path*", destination: `${auth}/api/v1/departments/:path*` },
      { source: "/api/v1/approval-lines", destination: `${auth}/api/v1/approval-lines` },
      { source: "/api/v1/approval-lines/:path*", destination: `${auth}/api/v1/approval-lines/:path*` },

      // ── attendance-service ──
      { source: "/api/v1/attendance/:path*", destination: `${att}/api/v1/attendance/:path*` },
      { source: "/api/v1/leave/:path*", destination: `${att}/api/v1/leave/:path*` },
      { source: "/api/v1/overtime/:path*", destination: `${att}/api/v1/overtime/:path*` },
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
