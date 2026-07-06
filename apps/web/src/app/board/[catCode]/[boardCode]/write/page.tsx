"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import PostEditor from "@/components/board/PostEditor";
import SearchBar from "@/components/board/SearchBar";
import { boardApi, postApi, getUser } from "@/lib/api";

export default function WritePostPage({
  params,
}: {
  params: { catCode: string; boardCode: string };
}) {
  const { catCode, boardCode } = params;
  const router = useRouter();
  const [board, setBoard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("erp_user");
    if (!token) {
      router.push("/login");
      return;
    }
    let cancelled = false;
    boardApi
      .getBoard(boardCode)
      .then((b: any) => {
        if (cancelled) return;
        setBoard(b);
        const user = getUser();
        const ok = user && Array.isArray(b?.writeRoles) && b.writeRoles.includes(user.role);
        setAuthorized(!!ok);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [boardCode, router]);

  const handleSubmit = async (v: {
    title: string;
    content: string;
    priority: number;
    expiresAt: string | null;
    attachmentIds: string[];
    targetDepartmentId?: string | null;
    requestType?: string;
    moduleArea?: string;
  }) => {
    const created = await postApi.create(boardCode, v);
    router.push(`/board/${catCode}/${boardCode}/${created.id}`);
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto px-6 py-12 flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      </AppLayout>
    );
  }

  if (!board) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto px-6 py-12 text-center text-gray-500">
          <p>보드를 찾을 수 없습니다.</p>
          <Link href={`/board/${catCode}`} className="text-blue-600 dark:text-blue-400 hover:underline text-sm mt-3 inline-block">
            ← {catCode}로 돌아가기
          </Link>
        </div>
      </AppLayout>
    );
  }

  if (!authorized) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto px-6 py-12 text-center text-gray-500">
          <p>이 보드에 글을 작성할 권한이 없습니다.</p>
          <Link href={`/board/${catCode}/${boardCode}`} className="text-blue-600 dark:text-blue-400 hover:underline text-sm mt-3 inline-block">
            ← 목록으로
          </Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="text-sm text-gray-500 flex items-center gap-1.5 mb-3">
          <Link href="/board" className="hover:text-gray-700">게시판</Link>
          <span>›</span>
          <Link href={`/board/${catCode}`} className="hover:text-gray-700">{catCode}</Link>
          <span>›</span>
          <Link href={`/board/${catCode}/${boardCode}`} className="hover:text-gray-700">{board.name}</Link>
          <span>›</span>
          <span className="text-gray-700 font-medium">새 글 작성</span>
        </div>

        <div className="mb-5">
          <SearchBar />
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h1 className="text-lg font-bold text-gray-900 mb-4">{board.name} · 새 글 작성</h1>
          <PostEditor
            onSubmit={handleSubmit}
            onCancel={() => router.push(`/board/${catCode}/${boardCode}`)}
            submitLabel="발행"
            showTargetDepartment={boardCode === "notice-dept"}
            showFeatureRequest={catCode === "feature-request" && boardCode === "feature-request-all"}
          />
        </div>
      </div>
    </AppLayout>
  );
}
