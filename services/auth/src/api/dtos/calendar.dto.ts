import { z } from "zod";
import { CalendarEntryType } from "@prisma/client";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식");
const colorString = z.string().regex(/^#[0-9a-fA-F]{6}$/, "#RRGGBB 형식");

export const createEntrySchema = z
  .object({
    type: z.nativeEnum(CalendarEntryType),
    title: z.string().min(1).max(200),
    description: z.string().max(1000).nullable().optional(),
    startDate: dateString,
    endDate: dateString,
    color: colorString.nullable().optional(),
  })
  .refine((d) => d.startDate <= d.endDate, {
    message: "종료일은 시작일보다 빠를 수 없습니다.",
    path: ["endDate"],
  });

export const updateEntrySchema = z
  .object({
    type: z.nativeEnum(CalendarEntryType).optional(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).nullable().optional(),
    startDate: dateString.optional(),
    endDate: dateString.optional(),
    color: colorString.nullable().optional(),
  })
  .refine(
    (d) => {
      if (d.startDate && d.endDate) return d.startDate <= d.endDate;
      return true;
    },
    {
      message: "종료일은 시작일보다 빠를 수 없습니다.",
      path: ["endDate"],
    },
  );

export const listEntryQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  type: z.nativeEnum(CalendarEntryType).optional(),
});

export const upcomingQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
});

export const holidaysQuerySchema = z.object({
  from: dateString,
  to: dateString,
});
