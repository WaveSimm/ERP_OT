"use client";

// 자원-모델-분리 PDCA Phase 3b-4b (2026-05-04)
// 외부 자원 등록·수정 모달

import { useState } from "react";
import { externalPersonApi, type ExternalPerson } from "@/lib/api";
import { DateInput } from "@/components/ui/DateInput";

interface Props {
  person: ExternalPerson | null;   // null = 신규 생성
  onClose: () => void;
  onSuccess: () => void;
}

export function ExternalPersonForm({ person, onClose, onSuccess }: Props) {
  const isEdit = !!person;
  const [name, setName] = useState(person?.name ?? "");
  const [company, setCompany] = useState(person?.company ?? "");
  const [contactEmail, setContactEmail] = useState(person?.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(person?.contactPhone ?? "");
  const [contractStart, setContractStart] = useState(person?.contractStart?.slice(0, 10) ?? "");
  const [contractEnd, setContractEnd] = useState(person?.contractEnd?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(person?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert("이름은 필수입니다.");
      return;
    }
    setSubmitting(true);
    try {
      const data = {
        name: name.trim(),
        company: company.trim() || null,
        contactEmail: contactEmail.trim() || null,
        contactPhone: contactPhone.trim() || null,
        contractStart: contractStart || null,
        contractEnd: contractEnd || null,
        notes: notes.trim() || null,
      };
      if (isEdit && person) {
        await externalPersonApi.update(person.id, data);
      } else {
        await externalPersonApi.create(data);
      }
      onSuccess();
    } catch (err: any) {
      alert((isEdit ? "수정" : "등록") + " 실패: " + (err.message ?? "오류"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-lg w-[480px] max-w-[90vw]">
        <div className="px-5 py-3 border-b">
          <h3 className="font-semibold">{isEdit ? "외부 자원 수정" : "외부 자원 등록"}</h3>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          <div>
            <label className="block text-gray-500 text-xs mb-1">이름 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5"
              required
            />
          </div>
          <div>
            <label className="block text-gray-500 text-xs mb-1">소속 업체</label>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-gray-500 text-xs mb-1">이메일</label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5"
              />
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1">전화</label>
              <input
                type="text"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-gray-500 text-xs mb-1">계약 시작</label>
              <DateInput value={contractStart} onChange={(e) => setContractStart(e.target.value)} />
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1">계약 종료</label>
              <DateInput value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-gray-500 text-xs mb-1">메모</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full border border-gray-300 rounded px-2 py-1.5"
            />
          </div>
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting}
            className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50">
            취소
          </button>
          <button type="submit" disabled={submitting}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {submitting ? "저장 중..." : isEdit ? "수정" : "등록"}
          </button>
        </div>
      </form>
    </div>
  );
}
