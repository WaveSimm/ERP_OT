"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RepairCustomersRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/procurement/customers");
  }, [router]);
  return null;
}
