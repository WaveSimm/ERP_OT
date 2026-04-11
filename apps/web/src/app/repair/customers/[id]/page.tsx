"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function RepairCustomerDetailRedirect() {
  const params = useParams();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/procurement/customers/${params.id}`);
  }, [router, params.id]);
  return null;
}
