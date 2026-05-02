"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import PostEditor from "@/components/board/PostEditor";
import SearchBar from "@/components/board/SearchBar";
import { postApi, getUser } from "@/lib/api";

export default function EditPostPage({
  params,
}: {
  params: { catCode: string; boardCode: string; postId: string };
}) {
  const { catCode, boardCode, postId } = params;
  const router = useRouter();
  const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("erp_user");
    if (!token) {
      router.push("/login");
      return;
    }
    let cancelled = false;
    postApi
      .get(postId)
      .then((p: any) => {
        if (cancelled) return;
        setPost(p);
        const user = getUser();
        const isAdmin = user?.role === "ADMIN";
        const isAuthor = p?.author?.id === user?.id;
        setAuthorized(!!(isAdmin || isAuthor));
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [postId, router]);

  const handleSubmit = async (v: {
    title: string;
    content: string;
    priority: number;
    expiresAt: string | null;
    attachmentIds: string[];
    targetDepartmentId?: string | null;
  }) => {
    const payload: any = {
      title: v.title,
      content: v.content,
      priority: v.priority,
      expiresAt: v.expiresAt,
    };
    if (v.targetDepartmentId !== undefined) payload.targetDepartmentId = v.targetDepartmentId;
    await postApi.update(postId, payload);
    router.push(`/board/${catCode}/${boardCode}/${postId}`);
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

  if (!post) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto px-6 py-12 text-center text-gray-500">
          <p>글을 찾을 수 없습니다.</p>
          <Link href={`/board/${catCode}/${boardCode}`} className="text-blue-600 hover:underline text-sm mt-3 inline-block">
            ← 목록으로
          </Link>
        </div>
      </AppLayout>
    );
  }

  if (!authorized) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto px-6 py-12 text-center text-gray-500">
          <p>이 글을 수정할 권한이 없습니다.</p>
          <Link href={`/board/${catCode}/${boardCode}/${postId}`} className="text-blue-600 hover:underline text-sm mt-3 inline-block">
            ← 글로 돌아가기
          </Link>
        </div>
      </AppLayout>
    );
  }

  const initialAttachments = (post.attachments ?? []).map((a: any) => ({
    id: a.id,
    fileName: a.fileName,
    fileSize: a.fileSize,
    mimeType: a.mimeType,
    isInline: a.isInline,
    url: a.url,
  }));

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="text-sm text-gray-500 flex items-center gap-1.5 mb-3">
          <Link href="/board" className="hover:text-gray-700">게시판</Link>
          <span>›</span>
          <Link href={`/board/${catCode}`} className="hover:text-gray-700">{catCode}</Link>
          <span>›</span>
          <Link href={`/board/${catCode}/${boardCode}`} className="hover:text-gray-700">{post.board?.name}</Link>
          <span>›</span>
          <Link href={`/board/${catCode}/${boardCode}/${postId}`} className="hover:text-gray-700 truncate max-w-[200px]">{post.title}</Link>
          <span>›</span>
          <span className="text-gray-700 font-medium">수정</span>
        </div>

        <div className="mb-5">
          <SearchBar />
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h1 className="text-lg font-bold text-gray-900 mb-4">글 수정</h1>
          <PostEditor
            initial={{
              title: post.title,
              content: post.content,
              priority: post.priority,
              expiresAt: post.expiresAt,
              attachments: initialAttachments,
              targetDepartmentId: post.targetDepartment?.id ?? null,
            }}
            onSubmit={handleSubmit}
            onCancel={() => router.push(`/board/${catCode}/${boardCode}/${postId}`)}
            submitLabel="저장"
            showTargetDepartment={boardCode === "notice-dept"}
          />
          <p className="text-xs text-gray-400 mt-4">
            ※ 첨부파일 추가/제거는 1차 출시 기능에서 지원하지 않습니다 (글 작성 시점에만 연결).
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
