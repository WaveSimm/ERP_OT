import { z } from "zod";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식");

export const createWorkLogSchema = z.object({
  content: z.string().min(1).max(51200),
  workedAt: dateString,
  segmentId: z.string().optional(),
});

export const updateWorkLogSchema = z.object({
  content: z.string().min(1).max(51200).optional(),
  workedAt: dateString.optional(),
});

export const listByTaskQuerySchema = z.object({
  segmentId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const listByProjectQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  authorId: z.string().optional(),
  taskId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursor: z.string().optional(),
});

export const listMineQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  projectId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
