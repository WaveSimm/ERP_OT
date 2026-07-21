"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * 공용자산 관리는 관리 섹션 탭으로 이동(2026-07-21): /management/equipment-resources.
 *   기존 링크·북마크 호환을 위한 리다이렉트.
 */
export default function AdminEquipmentResourcesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/management/equipment-resources");
  }, [router]);
  return null;
}
