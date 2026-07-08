"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EquipmentResourcesPanel } from "@/components/EquipmentResourcesPanel";
import { getUser } from "@/lib/api";

/**
 * 공용자산(EquipmentResource) 관리 페이지 — 관리자 전용.
 * 자원관리 → 공용자산 탭에서 이동 (2026-05-05).
 *
 * 모델: EquipmentResource (장비/차량/시설)
 * 사용처: 프로젝트 task 자원 배정 + 자원관리 직원현황 부하 모니터링
 */
export default function AdminEquipmentResourcesPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("erp_user");
    if (!token) {
      router.push("/login");
      return;
    }
    const me = getUser();
    const admin = me?.role === "ADMIN";
    setIsAdmin(admin);
    if (!admin) {
      router.push("/home");
      return;
    }
    setMounted(true);
  }, [router]);

  if (!mounted) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center text-gray-500">
        관리자 전용 페이지입니다.
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">공용자산 관리</h1>
      <p className="text-sm text-gray-500 mb-4">
        프로젝트 task 자원 배정과 직원현황 부하 모니터링에 사용되는 공용 장비·차량·시설을 관리합니다.
      </p>
      <EquipmentResourcesPanel isAdmin={isAdmin} />
    </div>
  );
}
