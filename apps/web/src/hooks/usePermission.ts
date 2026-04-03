"use client";

import { getUser } from "@/lib/api";
import { useState, useEffect } from "react";

/**
 * 현재 로그인 사용자의 Role 기반 권한 훅
 *
 * - isAdmin   : ADMIN (모든 권한)
 * - isManager : MANAGER 이상 (프로젝트/자원/태스크 관리)
 * - isOperator: OPERATOR 이상 (본인 태스크 수정, 조회)
 */
export function usePermission() {
  const [role, setRole] = useState<string>("VIEWER");

  useEffect(() => {
    const user = getUser();
    setRole(user?.role ?? "VIEWER");
  }, []);

  const isAdmin = role === "ADMIN";
  const isManager = role === "MANAGER" || isAdmin;
  const isOperator = role === "OPERATOR" || isManager;

  return { isAdmin, isManager, isOperator, role };
}
