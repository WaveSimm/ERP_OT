import { z } from "zod";

// 공용자산예약 (2026-05-05)

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식");

export const recurrenceSchema = z
  .object({
    freq: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
    interval: z.number().int().min(1).max(52).optional(),
    byWeekday: z
      .array(z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]))
      .min(1)
      .optional(),
    until: dateString.optional(),
    count: z.number().int().min(1).max(366).optional(),
  })
  .refine((r) => !!r.until || !!r.count, {
    message: "반복은 종료일(until) 또는 횟수(count) 중 하나가 필요합니다.",
  })
  .refine((r) => !(r.until && r.count), {
    message: "종료일과 횟수는 동시에 지정할 수 없습니다.",
  })
  .refine((r) => !(r.byWeekday && r.byWeekday.length > 0 && r.freq !== "WEEKLY"), {
    message: "byWeekday는 WEEKLY 빈도에서만 사용할 수 있습니다.",
  });

const isoDateTime = z.string().datetime({ offset: false }); // ISO UTC

function isHalfHourAligned(iso: string): boolean {
  const d = new Date(iso);
  return (
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0 &&
    d.getUTCMinutes() % 30 === 0
  );
}

export const createReservationSchema = z
  .object({
    resourceId: z.string().min(1),
    title: z.string().min(1).max(200),
    description: z.string().max(1000).nullable().optional(),
    startAt: isoDateTime,
    endAt: isoDateTime,
    isAllDay: z.boolean().optional(),
    recurrence: recurrenceSchema.nullable().optional(),
    logType: z.enum(["RENTAL", "MAINTENANCE"]).optional(),
    mileage: z.number().int().min(0).max(9_999_999).nullable().optional(),
  })
  .refine((d) => new Date(d.startAt) < new Date(d.endAt), {
    message: "종료시각은 시작시각보다 늦어야 합니다.",
    path: ["endAt"],
  })
  .refine(
    (d) => d.isAllDay || (isHalfHourAligned(d.startAt) && isHalfHourAligned(d.endAt)),
    {
      message: "시간은 30분 단위여야 합니다.",
    },
  );

export const updateReservationSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).nullable().optional(),
    startAt: isoDateTime.optional(),
    endAt: isoDateTime.optional(),
    isAllDay: z.boolean().optional(),
    recurrence: recurrenceSchema.nullable().optional(),
    logType: z.enum(["RENTAL", "MAINTENANCE"]).optional(),
    mileage: z.number().int().min(0).max(9_999_999).nullable().optional(),
  })
  .refine(
    (d) => {
      if (d.startAt && d.endAt) return new Date(d.startAt) < new Date(d.endAt);
      return true;
    },
    { message: "종료시각은 시작시각보다 늦어야 합니다.", path: ["endAt"] },
  )
  .refine(
    (d) => {
      if (d.isAllDay) return true;
      if (d.startAt && !isHalfHourAligned(d.startAt)) return false;
      if (d.endAt && !isHalfHourAligned(d.endAt)) return false;
      return true;
    },
    { message: "시간은 30분 단위여야 합니다." },
  );

export const listReservationQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  resourceId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
});

export const myReservationsQuerySchema = z.object({
  upcoming: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const scopeQuerySchema = z.object({
  scope: z.enum(["instance", "series"]).optional(), // 기본 instance
});

export const cancelReservationBodySchema = z.object({
  cancelReason: z.string().max(500).optional(),
});

export type CreateReservationDto = z.infer<typeof createReservationSchema>;
export type UpdateReservationDto = z.infer<typeof updateReservationSchema>;
export type RecurrenceDto = z.infer<typeof recurrenceSchema>;
