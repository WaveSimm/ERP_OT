"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function WorkLogsAllRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/work-logs");
  }, [router]);
  return null;
}
