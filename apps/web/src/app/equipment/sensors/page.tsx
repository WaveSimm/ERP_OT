"use client";

export const dynamic = 'force-dynamic';

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SensorRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/equipment?tab=sensors");
  }, [router]);
  return null;
}
