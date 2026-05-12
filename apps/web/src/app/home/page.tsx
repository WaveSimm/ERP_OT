"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import HomeHero from "@/components/home/HomeHero";
import NoticeFeedCard from "@/components/home/NoticeFeedCard";
import MyAttendanceCard from "@/components/home/MyAttendanceCard";
import PendingApprovalCard from "@/components/home/PendingApprovalCard";
import MyTasksCard from "@/components/home/MyTasksCard";
import MyProjectsCard from "@/components/home/MyProjectsCard";
import RecentNotificationsCard from "@/components/home/RecentNotificationsCard";
import ExpenseCard from "@/components/home/ExpenseCard";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("erp_user") : null;
    if (!token) router.push("/login");
  }, [router]);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-6 py-6">
        <HomeHero />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NoticeFeedCard />
          <MyAttendanceCard />
          <PendingApprovalCard />
          <ExpenseCard />
          <RecentNotificationsCard />
          <MyTasksCard />
          <MyProjectsCard />
        </div>
      </div>
    </AppLayout>
  );
}
