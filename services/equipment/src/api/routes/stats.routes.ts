import { FastifyInstance } from "fastify";

export async function statsRoutes(fastify: FastifyInstance) {
  // 전체 요약 (대시보드 카드)
  fastify.get("/summary", async () => {
    return fastify.statsService.summary();
  });

  // 장비 가동률
  fastify.get("/utilization", async (request) => {
    const { startDate, endDate } = request.query as any;
    if (!startDate || !endDate) throw new Error("startDate, endDate는 필수입니다.");
    return fastify.statsService.utilization(startDate, endDate);
  });

  // 정비 비용 통계
  fastify.get("/maintenance-costs", async (request) => {
    const { startDate, endDate } = request.query as any;
    return fastify.statsService.maintenanceCosts(startDate, endDate);
  });

  // 고장 빈도 Top-N
  fastify.get("/breakdown-frequency", async (request) => {
    const { limit } = request.query as any;
    return fastify.statsService.breakdownFrequency(limit ? parseInt(limit) : 10);
  });

  // 센서 교정 경고
  fastify.get("/calibration-warnings", async () => {
    return fastify.statsService.calibrationWarnings();
  });

  // 예방 정비 예정 (D-30 이내)
  fastify.get("/preventive-due", async (request) => {
    const { days } = request.query as any;
    return fastify.maintenanceService.getPreventiveDue(days ? parseInt(days) : 30);
  });
}
