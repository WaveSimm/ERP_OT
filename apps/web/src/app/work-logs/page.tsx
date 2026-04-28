"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import UnifiedBoardSidebar from "@/components/board/UnifiedBoardSidebar";
import { workLogApi } from "@/lib/api";

interface MyProjectBoardItem {
  projectId: string;
  projectName: string;
  status: string;
  logCount: number;
  lastLogAt: string | null;
}

export default function ProjectBoardLandingPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<MyProjectBoardItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("erp_token");
    if (!token) {
      router.push("/login");
      return;
    }
    let cancelled = false;
    workLogApi
      .myProjects()
      .then((data) => {
        if (cancelled) return;
        const items = (data ?? []) as MyProjectBoardItem[];
        setProjects(items);
        // 첫 프로젝트로 자동 이동 (가장 최근 비고가 있는 것)
        const sorted = [...items].sort((a, b) => {
          if (!a.lastLogAt && !b.lastLogAt) return 0;
          if (!a.lastLogAt) return 1;
          if (!b.lastLogAt) return -1;
          return b.lastLogAt.localeCompare(a.lastLogAt);
        });
        if (sorted.length > 0) {
          router.replace(`/work-logs/${sorted[0]!.projectId}`);
        }
      })
      .catch((e) => console.error("[work-logs landing]", e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="text-sm text-gray-500 flex items-center gap-1.5 mb-2">
          <Link href="/board" className="hover:text-gray-700">게시판</Link>
          <span>›</span>
          <span className="text-gray-700 font-medium">프로젝트 게시판</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-6">📝 프로젝트 게시판</h2>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
          </div>
        ) : projects.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl py-16 text-center text-gray-400 text-sm">
            참여 프로젝트가 없습니다. 작업에 자원으로 배정되거나 비고를 작성해야 표시됩니다.
          </div>
        ) : (
          <div className="flex gap-6">
            <UnifiedBoardSidebar />
            <div className="flex-1 bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-400">
              왼쪽에서 프로젝트를 선택하세요.
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
