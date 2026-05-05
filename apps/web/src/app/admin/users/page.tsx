"use client";

import UserAccountsTab from "@/components/UserAccountsTab";

export default function AdminUsersPage() {
  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">직원 관리</h1>
      <UserAccountsTab />
    </div>
  );
}
