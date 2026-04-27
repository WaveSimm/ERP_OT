import { z } from "zod";

export const createPostSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(102400), // 100KB 상한
  priority: z.number().int().min(0).max(2).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  attachmentIds: z.array(z.string()).optional(),
});

export const updatePostSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(102400).optional(),
  priority: z.number().int().min(0).max(2).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const togglePinSchema = z.object({
  isPinned: z.boolean(),
});

export const createCommentSchema = z.object({
  content: z.string().min(1).max(2000),
  parentId: z.string().optional(),
});

export const updateCommentSchema = z.object({
  content: z.string().min(1).max(2000),
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
