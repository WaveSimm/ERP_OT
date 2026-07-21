"use client";

import { useEffect, useState } from "react";
import { EquipmentResourcesPanel } from "@/components/EquipmentResourcesPanel";
import { getUser } from "@/lib/api";

/**
 * 공용자산(EquipmentResource) 관리 — 관리 섹션 탭 (2026-07-21 이전).
 *   접근 게이트: 상위 management 레이아웃(isManagementUser: 재무·경영지원·임원·대표 + ADMIN).
 *   편집(추가·수정·삭제·순서)은 백엔드가 ADMIN 전용 → isAdmin일 때만 편집 UI 노출,
 *   그 외 관리부서는 조회만 가능.
 */
export default function ManagementEquipmentResourcesPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    setIsAdmin(getUser()?.role === "ADMIN");
  }, []);

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        프로젝트 task 자원 배정과 직원현황 부하 모니터링에 사용되는 공용 장비·차량·시설을 관리합니다.
      </p>
      <EquipmentResourcesPanel isAdmin={isAdmin} />
    </div>
  );
}
