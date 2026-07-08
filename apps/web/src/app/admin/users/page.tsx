"use client";

import UserAccountsTab from "@/components/UserAccountsTab";

export default function AdminUsersPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">직원 관리</h1>
      <UserAccountsTab />
    </div>
  );
}
