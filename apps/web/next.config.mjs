/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      { source: "/api/v1/equipment", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/equipment` },
      { source: "/api/v1/equipment/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/equipment/:path*` },
      { source: "/api/v1/sensors", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/sensors` },
      { source: "/api/v1/sensors/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/sensors/:path*` },
      { source: "/api/v1/categories", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/categories` },
      { source: "/api/v1/categories/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/categories/:path*` },
      { source: "/api/v1/maintenance", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/maintenance` },
      { source: "/api/v1/maintenance/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/maintenance/:path*` },
      { source: "/api/v1/schedules", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/schedules` },
      { source: "/api/v1/schedules/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/schedules/:path*` },
      { source: "/api/v1/deployments", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/deployments` },
      { source: "/api/v1/deployments/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/deployments/:path*` },
      { source: "/api/v1/compatibility", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/compatibility` },
      { source: "/api/v1/compatibility/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/compatibility/:path*` },
      // 수리관리 API (equipment-service)
      { source: "/api/v1/customers", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/customers` },
      { source: "/api/v1/customers/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/customers/:path*` },
      { source: "/api/v1/customer-assets", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/customer-assets` },
      { source: "/api/v1/customer-assets/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/customer-assets/:path*` },
      { source: "/api/v1/repair-orders", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/repair-orders` },
      { source: "/api/v1/repair-orders/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/repair-orders/:path*` },
      { source: "/api/v1/inspection-reports", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/inspection-reports` },
      { source: "/api/v1/inspection-reports/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/inspection-reports/:path*` },
      { source: "/api/v1/repair-costs", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/repair-costs` },
      { source: "/api/v1/repair-costs/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/repair-costs/:path*` },
      { source: "/api/v1/repair-quotes", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/repair-quotes` },
      { source: "/api/v1/repair-quotes/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/repair-quotes/:path*` },
      { source: "/api/v1/parts", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/parts` },
      { source: "/api/v1/parts/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/parts/:path*` },
      { source: "/api/v1/part-transactions", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/part-transactions` },
      { source: "/api/v1/part-transactions/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/part-transactions/:path*` },
      { source: "/api/v1/purchase-orders", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/purchase-orders` },
      { source: "/api/v1/purchase-orders/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/purchase-orders/:path*` },
      { source: "/api/v1/shipments", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/shipments` },
      { source: "/api/v1/shipments/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/shipments/:path*` },
      { source: "/api/v1/repair-stats/:path*", destination: `${process.env.EQUIPMENT_SERVICE_URL || "http://localhost:3005"}/api/v1/repair-stats/:path*` },
      { source: "/api/v1/auth", destination: `${process.env.AUTH_SERVICE_URL || "http://localhost:3001"}/api/v1/auth` },
      { source: "/api/v1/auth/:path*", destination: `${process.env.AUTH_SERVICE_URL || "http://localhost:3001"}/api/v1/auth/:path*` },
      { source: "/api/v1/users", destination: `${process.env.AUTH_SERVICE_URL || "http://localhost:3001"}/api/v1/users` },
      { source: "/api/v1/users/:path*", destination: `${process.env.AUTH_SERVICE_URL || "http://localhost:3001"}/api/v1/users/:path*` },
      { source: "/api/v1/departments", destination: `${process.env.AUTH_SERVICE_URL || "http://localhost:3001"}/api/v1/departments` },
      { source: "/api/v1/departments/:path*", destination: `${process.env.AUTH_SERVICE_URL || "http://localhost:3001"}/api/v1/departments/:path*` },
      { source: "/api/v1/approval-lines", destination: `${process.env.AUTH_SERVICE_URL || "http://localhost:3001"}/api/v1/approval-lines` },
      { source: "/api/v1/approval-lines/:path*", destination: `${process.env.AUTH_SERVICE_URL || "http://localhost:3001"}/api/v1/approval-lines/:path*` },
      { source: "/api/v1/attendance/:path*", destination: `${process.env.ATTENDANCE_SERVICE_URL || "http://localhost:3004"}/api/v1/attendance/:path*` },
      { source: "/api/v1/leave/:path*", destination: `${process.env.ATTENDANCE_SERVICE_URL || "http://localhost:3004"}/api/v1/leave/:path*` },
      { source: "/api/v1/overtime/:path*", destination: `${process.env.ATTENDANCE_SERVICE_URL || "http://localhost:3004"}/api/v1/overtime/:path*` },
      { source: "/api/v1/policy/:path*", destination: `${process.env.ATTENDANCE_SERVICE_URL || "http://localhost:3004"}/api/v1/policy/:path*` },
      { source: "/api/v1/team/:path*", destination: `${process.env.ATTENDANCE_SERVICE_URL || "http://localhost:3004"}/api/v1/team/:path*` },
      { source: "/api/v1/notifications", destination: `${process.env.ATTENDANCE_SERVICE_URL || "http://localhost:3004"}/api/v1/notifications` },
      { source: "/api/v1/notifications/:path*", destination: `${process.env.ATTENDANCE_SERVICE_URL || "http://localhost:3004"}/api/v1/notifications/:path*` },
      { source: "/api/v1/work-schedule", destination: `${process.env.ATTENDANCE_SERVICE_URL || "http://localhost:3004"}/api/v1/work-schedule` },
      { source: "/api/v1/work-schedule/:path*", destination: `${process.env.ATTENDANCE_SERVICE_URL || "http://localhost:3004"}/api/v1/work-schedule/:path*` },
      { source: "/api/v1/:path*", destination: `${process.env.API_BASE_URL || "http://localhost:3003"}/api/v1/:path*` },
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
