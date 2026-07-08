// 내 대시보드 라우트 — 실제 본체는 dashboard-view.tsx의 DashboardBody.
// 모바일 /m 에서 동일 본체를 mobile prop과 함께 재사용한다.
import { DashboardBody } from "./dashboard-view";

export default function DashboardPage() {
  return <DashboardBody />;
}
