"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ScheduleRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/equipment?tab=schedule");
  }, [router]);
  return null;
}
