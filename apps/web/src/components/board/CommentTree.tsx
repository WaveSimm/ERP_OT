"use client";

import { useState, useEffect } from "react";
import { boardCommentApi, getUser } from "@/lib/api";
import CommentForm from "./CommentForm";
import { extractMentionIds, MentionText } from "@/components/MentionInput";
import { CommentIcon } from "@/components/ui/icons";

interface Comment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  parentId: string | null;
  content: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  children?: Comment[];
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  const dt = new Date(iso);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function CommentItem({
  comment,
  postId,
  isReply,
  onChange,
}: {
  comment: Comment;
  postId: string;
  isReply: boolean;
  onChange: () => void;
}) {
  const me = getUser();
  const isAdmin = me?.role === "ADMIN";
  const isMine = comment.authorId === me?.id;
  const canEdit = !comment.isDeleted && (isAdmin || isMine);

  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);

  const handleEdit = async (content: string) => {
    await boardCommentApi.update(comment.id, content, await extractMentionIds(content));
    setEditing(false);
    onChange();
  };

  const handleDelete = async () => {
    if (!confirm("댓글을 삭제하시겠습니까?")) return;
    await boardCommentApi.remove(comment.id);
    onChange();
  };

  const handleReply = async (content: string) => {
    await boardCommentApi.create(postId, { content, parentId: comment.id, mentionedUserIds: await extractMentionIds(content) });
    setReplying(false);
    onChange();
  };

  return (
    <div className={isReply ? "pl-8 mt-2" : "mt-3"}>
      <div className="bg-gray-50 rounded-lg px-3 py-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-gray-800">{comment.authorName}</span>
          <span className="text-xs text-gray-400">{timeAgo(comment.createdAt)}</span>
          {comment.updatedAt !== comment.createdAt && !comment.isDeleted && (
            <span className="text-xs text-gray-400">(수정됨)</span>
          )}
        </div>

        {editing ? (
          <CommentForm
            onSubmit={handleEdit}
            onCancel={() => setEditing(false)}
            initial={comment.content}
            submitLabel="저장"
            compact
          />
        ) : (
          <div className={`text-sm whitespace-pre-wrap ${comment.isDeleted ? "text-gray-400 italic" : "text-gray-800"}`}>
            {comment.isDeleted ? comment.content : <MentionText text={comment.content} />}
          </div>
        )}

        {!editing && !comment.isDeleted && (
          <div className="flex gap-3 mt-1.5 text-xs">
            {!isReply && (
              <button
                type="button"
                onClick={() => setReplying((v) => !v)}
                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                답글
              </button>
            )}
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  수정
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                >
                  삭제
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {replying && (
        <div className="pl-3 mt-2">
          <CommentForm
            onSubmit={handleReply}
            onCancel={() => setReplying(false)}
            placeholder={`@${comment.authorName} 에게 답글...`}
            submitLabel="답글"
            compact
          />
        </div>
      )}

      {comment.children && comment.children.length > 0 && (
        <div className="mt-1">
          {comment.children.map((c) => (
            <CommentItem key={c.id} comment={c} postId={postId} isReply onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CommentTree({ postId }: { postId: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      const data = await boardCommentApi.list(postId);
      setComments((data ?? []) as Comment[]);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    boardCommentApi
      .list(postId)
      .then((data) => {
        if (!cancelled) setComments((data ?? []) as Comment[]);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [postId]);

  const totalCount = (() => {
    let n = 0;
    const walk = (arr: Comment[]) => {
      for (const c of arr) {
        if (!c.isDeleted) n++;
        if (c.children) walk(c.children);
      }
    };
    walk(comments);
    return n;
  })();

  const handleNewTopComment = async (content: string) => {
    await boardCommentApi.create(postId, { content, mentionedUserIds: await extractMentionIds(content) });
    await reload();
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-gray-700"><CommentIcon className="w-4 h-4" /> 댓글</span>
        <span className="text-xs text-gray-400">{totalCount}개</span>
      </div>

      <CommentForm onSubmit={handleNewTopComment} placeholder="댓글을 작성하세요" />

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full" />
        </div>
      ) : comments.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-400">첫 댓글을 작성해보세요.</div>
      ) : (
        <div>
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} postId={postId} isReply={false} onChange={reload} />
          ))}
        </div>
      )}
    </div>
  );
}
