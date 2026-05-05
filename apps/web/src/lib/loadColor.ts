/**
 * loadColor — 자원 부하율 → Tailwind class 매핑
 *
 * 단계별 색상 (자원 행 + task bar 동일 기준):
 * - 0%: 회색
 * - 1~50%: 옅은 파랑
 * - 51~100%: 진한 파랑
 * - 101~150%: 주황 (overload 시작)
 * - >150%: 빨강 (심각한 overload)
 *
 * Phase 3 추가 예정:
 * - 휴일 (배정 무관): 회색 사선
 * - 휴일근무: 보라
 * - 연차/병가: 분홍
 */

export interface LoadStateOptions {
  isHoliday?: boolean | undefined;
  hasHolidayWork?: boolean | undefined;
  leaveType?: string | undefined; // ANNUAL/HALF/QUARTER/FAMILY_DAY/...
  isWeekend?: boolean | undefined;
}

/**
 * 부하율 → background class
 */
export function loadColor(percent: number, opts: LoadStateOptions = {}): string {
  const { isHoliday, hasHolidayWork, leaveType, isWeekend } = opts;

  // Phase 3에서 활성화 (현재는 placeholder)
  if (leaveType) return "bg-pink-200";
  if (hasHolidayWork) return "bg-purple-400";
  if (isHoliday) return "bg-gray-300";
  if (isWeekend) return "bg-gray-100";

  if (percent === 0) return "bg-gray-50";
  if (percent <= 50) return "bg-blue-200";
  if (percent <= 100) return "bg-blue-500";
  if (percent <= 150) return "bg-orange-400";
  return "bg-red-500";
}

/**
 * 부하율 → 텍스트 색 (배경 위에)
 */
export function loadTextColor(percent: number, opts: LoadStateOptions = {}): string {
  if (opts.isHoliday || opts.isWeekend) return "text-gray-400";
  if (percent === 0) return "text-gray-300";
  if (percent <= 50) return "text-blue-900";
  if (percent <= 100) return "text-white";
  return "text-white";
}

/**
 * 부하 단계 라벨 (overlay·tooltip 용)
 */
export function loadLabel(percent: number, opts: LoadStateOptions = {}): string {
  if (opts.leaveType) return "휴가";
  if (opts.hasHolidayWork) return "휴일근무";
  if (opts.isHoliday) return "공휴일";
  if (opts.isWeekend) return "주말";
  if (percent === 0) return "여유";
  if (percent <= 100) return "정상";
  if (percent <= 150) return "주의";
  return "과부하";
}
