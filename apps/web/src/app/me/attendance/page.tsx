"use client";

import AttendanceView from "@/components/AttendanceView";

export default function AttendancePage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">내 근태</h1>
      <AttendanceView />
    </div>
  );
}
