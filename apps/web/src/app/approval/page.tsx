"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { approvalApi } from "@/lib/api";
import { useFillHeight } from "@/hooks/useFillHeight";
import { TableCard, Table, THead, Th, TBody, Tr, Td, TableEmpty, StatusBadge } from "@/components/ui/Table";

function getStatusStyle(status: string) {
  if (status === "DRAFT") return "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200";
  if (status === "APPROVED") return "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300";
  if (status === "REJECTED") return "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300";
  return "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300"; // 결재중
}

function getStatusLabel(status: string) {
  if (status === "DRAFT") return "임시저장";
  if (status === "APPROVED") return "완료";
  if (status === "REJECTED") return "반려";
  return "결재중";
}


type Tab = "pending" | "sent" | "completed";

export default function ApprovalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = (searchParams.get("tab") as Tab) || "pending";

  const [tab, setTab] = useState<Tab>(tabParam);
  const { ref: tableBoxRef, maxHeight: tableMaxH } = useFillHeight();
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let res: any;
      if (tab === "pending") res = await approvalApi.getPendingDocuments();
      else if (tab === "sent") res = await approvalApi.getSentDocuments();
      else res = await approvalApi.getCompletedDocuments();
      setDocuments(Array.isArray(res) ? res : res.items || res.documents || []);
    } catch (e) {
      console.error("Failed to load documents", e);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { setTab(tabParam); }, [tabParam]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <TableCard scrollRef={tableBoxRef} maxHeight={tableMaxH}>
        <Table fixed columnDividers>
          <colgroup>
            <col className="w-[11%]" />
            <col className="w-[12%]" />
            <col className="w-[22%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[9%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
          </colgroup>
          <THead>
            <Th align="center">문서번호</Th>
            <Th align="center">양식</Th>
            <Th align="center">제목</Th>
            <Th align="center">기안자</Th>
            <Th align="center">결재자</Th>
            <Th align="center">상태</Th>
            <Th align="center">금액</Th>
            <Th align="center">상신일</Th>
          </THead>
          <TBody>
            {loading ? (
              <TableEmpty colSpan={8}>로딩 중...</TableEmpty>
            ) : documents.length === 0 ? (
              <TableEmpty colSpan={8}>
                {tab === "pending" ? "대기 중인 결재가 없습니다." :
                 tab === "sent" ? "상신한 문서가 없습니다." : "완료된 문서가 없습니다."}
              </TableEmpty>
            ) : documents.map((doc: any) => (
              <Tr key={doc.id} onClick={() => router.push(`/approval/${doc.id}`)}>
                <Td dash mono align="left" truncate title={doc.documentNumber || undefined}>{doc.documentNumber}</Td>
                <Td align="center"><StatusBadge color="gray">{doc.template?.name || "-"}</StatusBadge></Td>
                <Td strong truncate title={doc.title || undefined}>{doc.title || "-"}</Td>
                <Td dash align="center" truncate title={doc.requesterName || doc.drafterName || undefined}>{doc.requesterName || doc.drafterName}</Td>
                <Td align="center" truncate>
                  {(() => {
                    if (doc.status === "DRAFT") return "-";
                    const steps = doc.steps || [];
                    if (doc.status === "APPROVED" || doc.status === "REJECTED") {
                      const acted = steps.filter((s: any) => s.status === "APPROVED" || s.status === "REJECTED");
                      const last = acted.sort((a: any, b: any) => b.stepOrder - a.stepOrder)[0];
                      return last?.approverName || "-";
                    }
                    const pending = steps.find((s: any) => s.status === "PENDING");
                    return pending?.approverName || "-";
                  })()}
                </Td>
                <Td align="center">
                  <span className={`text-xs px-2 py-0.5 rounded ${getStatusStyle(doc.status)}`}>
                    {getStatusLabel(doc.status)}
                  </span>
                </Td>
                <Td align="right" mono>
                  {(doc.amount || doc.itemsTotal || doc.totalAmount) ? `₩${Number(doc.amount || doc.itemsTotal || doc.totalAmount).toLocaleString()}` : "-"}
                </Td>
                <Td align="center" mono>{doc.submittedAt ? new Date(doc.submittedAt).toLocaleDateString("ko-KR") : "-"}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableCard>
    </div>
  );
}
