// 모바일 홈 — 기존 내 대시보드 본체(DashboardBody)를 mobile 모드로 재사용.
// 탭: 근태·칸반·작업목록만 노출(DashboardBody 내부에서 필터).
import { DashboardBody } from "@/app/me/dashboard/dashboard-view";

export default function MobileHome() {
  return <DashboardBody mobile />;
}
