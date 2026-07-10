import { z } from "zod";

export const createTaskIssueSchema = z.object({
  content: z.string().min(1).max(2000),
});

export const updateTaskIssueSchema = z.object({
  content: z.string().min(1).max(2000).optional(),
  isResolved: z.boolean().optional(),
});
