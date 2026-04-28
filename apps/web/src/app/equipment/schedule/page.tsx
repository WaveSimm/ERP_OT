"use client";

export const dynamic = 'force-dynamic';

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ScheduleRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/equipment?tab=schedule");
  }, [router]);
  return null;
}
