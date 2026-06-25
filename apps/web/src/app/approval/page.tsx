"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { approvalApi } from "@/lib/api";

function getStatusStyle(status: string) {
  if (status === "DRAFT") return "bg-gray-100 text-gray-700";
  if (status === "APPROVED") return "bg-green-100 text-green-700";
  if (status === "REJECTED") return "bg-red-100 text-red-700";
  return "bg-yellow-100 text-yellow-700"; // 결재중
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
      {loading ? (
        <div className="text-center py-12 text-gray-400">로딩 중...</div>
      ) : documents.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          {tab === "pending" ? "대기 중인 결재가 없습니다." :
           tab === "sent" ? "상신한 문서가 없습니다." : "완료된 문서가 없습니다."}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-3 font-medium">문서번호</th>
                <th className="text-left px-4 py-3 font-medium">양식</th>
                <th className="text-left px-4 py-3 font-medium">제목</th>
                <th className="text-left px-4 py-3 font-medium">기안자</th>
                <th className="text-left px-4 py-3 font-medium">결재자</th>
                <th className="text-center px-4 py-3 font-medium">상태</th>
                <th className="text-center px-4 py-3 font-medium">금액</th>
                <th className="text-right px-4 py-3 font-medium">상신일</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {documents.map((doc: any) => (
                <tr
                  key={doc.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => router.push(`/approval/${doc.id}`)}
                >
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                    {doc.documentNumber || "-"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                      {doc.template?.name || "-"}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{doc.title || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{doc.requesterName || doc.drafterName || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">
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
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded ${getStatusStyle(doc.status)}`}>
                      {getStatusLabel(doc.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {(doc.amount || doc.itemsTotal || doc.totalAmount) ? `₩${Number(doc.amount || doc.itemsTotal || doc.totalAmount).toLocaleString()}` : "-"}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {doc.submittedAt ? new Date(doc.submittedAt).toLocaleDateString("ko-KR") : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
