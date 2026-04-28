"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import PostMarkdownView from "@/components/board/PostMarkdownView";
import PostAttachmentList from "@/components/board/PostAttachmentList";
import CommentTree from "@/components/board/CommentTree";
import SearchBar from "@/components/board/SearchBar";
import { postApi, getUser } from "@/lib/api";

export default function PostDetailPage({ params }: { params: { catCode: string; boardCode: string; postId: string } }) {
  const { catCode, boardCode, postId } = params;
  const router = useRouter();
  const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pinning, setPinning] = useState(false);

  const me = getUser();
  const isAdmin = me?.role === "ADMIN";
  const isAuthor = post?.author?.id === me?.id;
  const canPin = isAdmin || isAuthor;
  const canEdit = isAdmin || isAuthor;

  useEffect(() => {
    const token = localStorage.getItem("erp_token");
    if (!token) {
      router.push("/login");
      return;
    }
    let cancelled = false;
    setLoading(true);
    postApi
      .get(postId)
      .then((p) => {
        if (!cancelled) setPost(p);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message ?? "조회 실패");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [postId, router]);

  const handlePinToggle = async () => {
    if (!post) return;
    setPinning(true);
    try {
      const r = await postApi.togglePin(post.id, !post.isPinned);
      setPost({ ...post, isPinned: r.isPinned });
    } catch (e: any) {
      alert(e.message ?? "핀 처리 실패");
    } finally {
      setPinning(false);
    }
  };

  const handleDelete = async () => {
    if (!post) return;
    if (!confirm(`"${post.title}" 글을 삭제하시겠습니까? 복구할 수 없습니다.`)) return;
    try {
      await postApi.remove(post.id);
      router.push(`/board/${catCode}/${boardCode}`);
    } catch (e: any) {
      alert(e.message ?? "삭제 실패");
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto px-6 py-6">
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error || !post) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto px-6 py-12 text-center text-gray-500">
          <p className="mb-4">{error ?? "글을 찾을 수 없습니다."}</p>
          <Link href={`/board/${catCode}/${boardCode}`} className="text-blue-600 hover:underline text-sm">
            ← 목록으로
          </Link>
        </div>
      </AppLayout>
    );
  }

  const dt = new Date(post.publishedAt);
  const dtStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="text-sm text-gray-500 flex items-center gap-1.5 mb-3">
          <Link href="/board" className="hover:text-gray-700">게시판</Link>
          <span>›</span>
          <Link href={`/board/${catCode}`} className="hover:text-gray-700">{catCode}</Link>
          <span>›</span>
          <Link href={`/board/${catCode}/${boardCode}`} className="hover:text-gray-700">{post.board.name}</Link>
        </div>

        <div className="mb-5">
          <SearchBar />
        </div>

        <div className="bg-white border border-gray-200 rounded-xl">
          <div className="px-6 py-4 border-b border-gray-100">
            <div className="flex items-start gap-2">
              {post.isPinned && <span className="text-blue-600 mt-1">📌</span>}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {post.priority === 1 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">중요</span>}
                  {post.priority === 2 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">긴급</span>}
                  <h1 className="text-xl font-bold text-gray-900">{post.title}</h1>
                </div>
                <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-700">{post.author.name}</span>
                  {post.publishingDepartment && <span>· {post.publishingDepartment.name}</span>}
                  {post.targetDepartment && (
                    <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-semibold">
                      📌 {post.targetDepartment.name} 부서 공지
                    </span>
                  )}
                  <span>· {dtStr}</span>
                  <span>· 👁 {post.viewCount}</span>
                  {post.commentCount > 0 && <span>· 💬 {post.commentCount}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {canPin && (
                  <button
                    onClick={handlePinToggle}
                    disabled={pinning}
                    className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    {post.isPinned ? "📌 핀 해제" : "📌 핀"}
                  </button>
                )}
                {canEdit && (
                  <Link
                    href={`/board/${catCode}/${boardCode}/${post.id}/edit`}
                    className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
                  >
                    수정
                  </Link>
                )}
                {canEdit && (
                  <button
                    onClick={handleDelete}
                    className="px-3 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50"
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="px-6 py-5">
            <PostMarkdownView content={post.content} />
            <PostAttachmentList attachments={post.attachments ?? []} />
          </div>

          <div className="px-6 py-5 border-t border-gray-100">
            <CommentTree postId={post.id} />
          </div>
        </div>

        <div className="mt-4">
          <Link
            href={`/board/${catCode}/${boardCode}`}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← 목록으로
          </Link>
        </div>
      </div>
    </AppLayout>
  );
}
