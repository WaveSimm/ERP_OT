import { z } from "zod";

export const createPostSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(102400), // 100KB 상한
  priority: z.number().int().min(0).max(2).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  attachmentIds: z.array(z.string()).optional(),
  targetDepartmentId: z.string().nullable().optional(),
  // 게시판 design v2.0 (2026-05-22): 기능 요구 카테고리 전용 필드 (다른 카테고리는 무시됨)
  requestType: z.enum(["BUG", "NEW_FEATURE", "IMPROVEMENT", "UI_UX", "DOCS", "OTHER"]).optional(),
  moduleArea: z.string().max(100).optional(),
  mentionedUserIds: z.array(z.string()).optional(),
});

export const updatePostSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(102400).optional(),
  priority: z.number().int().min(0).max(2).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  targetDepartmentId: z.string().nullable().optional(),
  mentionedUserIds: z.array(z.string()).optional(),
});

export const togglePinSchema = z.object({
  isPinned: z.boolean(),
});

export const createCommentSchema = z.object({
  content: z.string().min(1).max(2000),
  parentId: z.string().optional(),
  mentionedUserIds: z.array(z.string()).optional(),
});

export const updateCommentSchema = z.object({
  content: z.string().min(1).max(2000),
  mentionedUserIds: z.array(z.string()).optional(),
});

export const listPostsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
  search: z.string().optional(),
  publishingDeptId: z.string().optional(),
  priority: z.coerce.number().int().min(0).max(2).optional(),
});

export const feedQuerySchema = z.object({
  categoryCode: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});
