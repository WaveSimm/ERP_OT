"use client";

// 자원-모델-분리 PDCA Phase 3b-2 (2026-05-04)
// 직원 퇴직 처리 확인 모달

import { useState } from "react";
import { DateInput } from "@/components/ui/DateInput";
import { userManagementApi } from "@/lib/api";

interface Props {
  user: { id: string; name: string; email: string };
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function RetireUserDialog({ user, open, onClose, onSuccess }: Props) {
  const [retirementDate, setRetirementDate] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!confirm(`${user.name}님을 퇴직 처리하시겠습니까?\n로그인·결재·신규 배정이 차단됩니다.`)) return;
    setSubmitting(true);
    try {
      await userManagementApi.retire(user.id, retirementDate);
      onSuccess();
      onClose();
    } catch (err: any) {
      alert("퇴직 처리 실패: " + (err.message ?? "오류"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-lg w-[420px] max-w-[90vw]">
        <div className="px-5 py-3 border-b">
          <h3 className="font-semibold">퇴직 처리</h3>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="text-sm">
            <div className="text-gray-500 text-xs mb-1">대상</div>
            <div className="font-medium">{user.name}</div>
            <div className="text-xs text-gray-400">{user.email}</div>
          </div>
          <div className="text-sm">
            <div className="text-gray-500 text-xs mb-1">퇴직일</div>
            <DateInput value={retirementDate} onChange={(e) => setRetirementDate(e.target.value)} />
          </div>
          <div className="text-xs text-gray-500 bg-gray-50 rounded p-2">
            ⚠️ 퇴직 처리 후:
            <ul className="list-disc list-inside mt-1">
              <li>로그인 차단 (status=RETIRED)</li>
              <li>새 task 배정·결재라인 후보에서 자동 제외</li>
              <li>과거 데이터(휴가·근태·작성글)는 그대로 보존</li>
              <li>관리자 화면에서 "복귀 처리"로 되돌릴 수 있음</li>
            </ul>
          </div>
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? "처리 중..." : "퇴직 처리"}
          </button>
        </div>
      </div>
    </div>
  );
}
