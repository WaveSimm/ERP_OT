import { z } from "zod";

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "MANAGER", "OPERATOR", "VIEWER"]).default("OPERATOR"),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["ADMIN", "MANAGER", "OPERATOR", "VIEWER"]).optional(),
  isActive: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(8),
});

export const upsertProfileSchema = z.object({
  phoneOffice:    z.string().max(20).optional().nullable(),
  phoneMobile:    z.string().max(20).optional().nullable(),
  address:        z.string().max(200).optional().nullable(),
  departmentId:   z.string().optional().nullable(),
  departmentName: z.string().max(100).optional().nullable(),
});

export type CreateUserDto   = z.infer<typeof createUserSchema>;
export type UpdateUserDto   = z.infer<typeof updateUserSchema>;
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
export type UpsertProfileDto = z.infer<typeof upsertProfileSchema>;
