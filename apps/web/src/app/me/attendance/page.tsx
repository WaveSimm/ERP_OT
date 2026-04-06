"use client";

import AttendanceView from "@/components/AttendanceView";

export default function AttendancePage() {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">내 근태</h1>
      <AttendanceView />
    </div>
  );
}
