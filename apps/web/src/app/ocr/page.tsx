"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ocrApi } from "@/lib/api";
import Pagination from "@/components/Pagination";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PROCESSING: { label: "처리중", color: "bg-blue-100 text-blue-800" },
  PENDING_REVIEW: { label: "확인대기", color: "bg-yellow-100 text-yellow-800" },
  CONFIRMED: { label: "확인완료", color: "bg-green-100 text-green-800" },
  APPLIED: { label: "ERP반영", color: "bg-indigo-100 text-indigo-800" },
  FAILED: { label: "실패", color: "bg-red-100 text-red-800" },
};

export default function OcrHistoryPage() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ status: "", templateCode: "" });
  const [templates, setTemplates] = useState<any[]>([]);

  useEffect(() => {
    ocrApi.listTemplates().then(setTemplates).catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    ocrApi
      .listResults({ ...filters, page, limit: 20 })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setTotalPages(res.totalPages);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page, filters]);

  const handleDelete = async (id: string) => {
    if (!confirm("이 OCR 결과를 삭제하시겠습니까?")) return;
    try {
      await ocrApi.deleteResult(id);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div>
      {/* 필터 + 새 스캔 버튼 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={filters.status}
          onChange={(e) => { setFilters((f) => ({ ...f, status: e.target.value })); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="">전체 상태</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        <select
          value={filters.templateCode}
          onChange={(e) => { setFilters((f) => ({ ...f, templateCode: e.target.value })); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="">전체 문서유형</option>
          {templates.map((t: any) => (
            <option key={t.code} value={t.code}>{t.name}</option>
          ))}
        </select>

        <div className="flex-1" />
        <span className="text-sm text-gray-500">총 {total}건</span>
        <button
          onClick={() => router.push("/ocr/scan")}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          + 새 스캔
        </button>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-3 text-left">#</th>
              <th className="px-4 py-3 text-left">문서유형</th>
              <th className="px-4 py-3 text-left">파일명</th>
              <th className="px-4 py-3 text-center">신뢰도</th>
              <th className="px-4 py-3 text-center">상태</th>
              <th className="px-4 py-3 text-left">처리일</th>
              <th className="px-4 py-3 text-center">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">불러오는 중...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">OCR 처리 이력이 없습니다.</td></tr>
            ) : items.map((item, idx) => {
              const st = STATUS_LABELS[item.status] || { label: item.status, color: "bg-gray-100 text-gray-600" };
              const conf = item.overallConfidence;
              const confColor = conf >= 0.95 ? "text-green-600 dark:text-green-400" : conf >= 0.8 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400";
              return (
                <tr key={item.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/ocr/scan?id=${item.id}`)}>
                  <td className="px-4 py-3 text-gray-400">{(page - 1) * 20 + idx + 1}</td>
                  <td className="px-4 py-3">{item.template?.name || item.templateCode || "-"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{item.originalFileName}</td>
                  <td className="px-4 py-3 text-center">
                    {conf != null ? (
                      <span className={`font-medium ${confColor}`}>{Math.round(conf * 100)}%</span>
                    ) : "-"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${st.color}`}>{st.label}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{new Date(item.createdAt).toLocaleDateString("ko-KR")}</td>
                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    {item.status === "PENDING_REVIEW" && (
                      <button
                        onClick={() => router.push(`/ocr/scan?id=${item.id}`)}
                        className="text-blue-600 dark:text-blue-400 hover:underline text-xs mr-2"
                      >
                        수정
                      </button>
                    )}
                    <button onClick={() => handleDelete(item.id)} className="text-red-500 dark:text-red-400 hover:underline text-xs">삭제</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} className="mt-4 border rounded-lg" />
    </div>
  );
}
