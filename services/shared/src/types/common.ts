import { z } from "zod";

// Pagination
export const PaginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof PaginationSchema>;

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// Timestamps
export interface Timestamps {
  createdAt: Date;
  updatedAt: Date;
}

// Base Entity
export interface BaseEntity extends Timestamps {
  id: string;
}
