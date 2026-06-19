"use client";

import { useParams } from "next/navigation";
import { SettlementDetail } from "../../_components/settlement-detail";

export default function SettlementDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <SettlementDetail id={id} />;
}
