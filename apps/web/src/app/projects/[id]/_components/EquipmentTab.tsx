"use client";

import { useRouter } from "next/navigation";

interface EquipmentTabProps {
  deploymentsLoading: boolean;
  projectDeployments: any[];
  router: ReturnType<typeof useRouter>;
}

export default function EquipmentTab({ deploymentsLoading, projectDeployments, router }: EquipmentTabProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">투입 장비 / 센서</h3>
        <button onClick={() => window.open("/equipment", "_blank")}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline">장비 관리 →</button>
      </div>
      {deploymentsLoading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : projectDeployments.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white rounded-xl border border-dashed border-gray-200">
          <div className="text-3xl mb-2">🔧</div>
          <p className="text-sm mb-2">투입된 장비가 없습니다.</p>
          <p className="text-xs text-gray-400">장비 관리 &gt; 장비 상세에서 &ldquo;프로젝트에 투입&rdquo;을 이용하세요.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projectDeployments.map((d) => {
            const statusMap: Record<string, { label: string; color: string }> = {
              PLANNED: { label: "계획", color: "bg-gray-100 text-gray-600" },
              ACTIVE: { label: "진행중", color: "bg-blue-100 text-blue-700" },
              COMPLETED: { label: "완료", color: "bg-green-100 text-green-700" },
              CANCELLED: { label: "취소", color: "bg-red-100 text-red-600" },
            };
            const st = statusMap[d.status] ?? { label: d.status, color: "bg-gray-100" };
            return (
              <div key={d.id} className="bg-white border rounded-lg p-4">
                {d.equipment ? (
                  <>
                    {/* 장비 투입 */}
                    <div className="flex items-center justify-between mb-2 cursor-pointer hover:bg-gray-50 rounded -m-1 p-1 transition-colors"
                      onClick={() => router.push(`/equipment/${d.equipment.id}?tab=schedules`)}>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">🔧</span>
                        <span className="font-semibold text-blue-600 dark:text-blue-400 hover:underline">{d.equipment.name}</span>
                        <span className="text-xs text-gray-400">{d.equipment.category?.name}</span>
                        {d.equipment.model && <span className="text-xs text-gray-400">· {d.equipment.model}</span>}
                        <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                      </div>
                      <span className="text-sm text-gray-500">
                        {new Date(d.startDate).toLocaleDateString()} ~ {d.endDate ? new Date(d.endDate).toLocaleDateString() : "미정"}
                      </span>
                    </div>
                    {d.sensors?.length > 0 && (
                      <div className="mt-2 pl-7">
                        <div className="text-xs text-gray-500 mb-1">장착 센서:</div>
                        <div className="flex flex-wrap gap-2">
                          {d.sensors.map((ds: any) => (
                            <div key={ds.id} className="flex items-center gap-1 bg-gray-50 border rounded px-2 py-1 text-xs cursor-pointer hover:bg-blue-50 hover:border-blue-200 transition-colors"
                              onClick={() => router.push(`/equipment/sensors/${ds.sensor?.id}?tab=schedules`)}>
                              <span>📡</span>
                              <span className="font-medium text-blue-600 dark:text-blue-400">{ds.sensor?.name}</span>
                              <span className="text-gray-400">{ds.sensor?.model}</span>
                              <span className="text-gray-400">SN: {ds.sensor?.serialNumber}</span>
                              {ds.notes && <span className="text-gray-400 ml-1">({ds.notes})</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* 센서 단독 투입 */}
                    <div className="flex items-center justify-between mb-2 cursor-pointer hover:bg-gray-50 rounded -m-1 p-1 transition-colors"
                      onClick={() => d.sensors?.length === 1 && router.push(`/equipment/sensors/${d.sensors[0].sensor?.id}?tab=schedules`)}>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">📡</span>
                        {d.sensors?.length === 1 ? (
                          <>
                            <span className="font-semibold text-blue-600 dark:text-blue-400 hover:underline">{d.sensors[0].sensor?.name}</span>
                            <span className="text-xs text-gray-400">{d.sensors[0].sensor?.model}</span>
                            <span className="text-xs text-gray-400">SN: {d.sensors[0].sensor?.serialNumber}</span>
                          </>
                        ) : (
                          <span className="font-semibold">센서 {d.sensors?.length ?? 0}개</span>
                        )}
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">센서 단독</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                      </div>
                      <span className="text-sm text-gray-500">
                        {new Date(d.startDate).toLocaleDateString()} ~ {d.endDate ? new Date(d.endDate).toLocaleDateString() : "미정"}
                      </span>
                    </div>
                    {d.sensors?.length > 1 && (
                      <div className="mt-2 pl-7">
                        <div className="flex flex-wrap gap-2">
                          {d.sensors.map((ds: any) => (
                            <div key={ds.id} className="flex items-center gap-1 bg-gray-50 border rounded px-2 py-1 text-xs cursor-pointer hover:bg-blue-50 hover:border-blue-200 transition-colors"
                              onClick={() => router.push(`/equipment/sensors/${ds.sensor?.id}?tab=schedules`)}>
                              <span>📡</span>
                              <span className="font-medium text-blue-600 dark:text-blue-400">{ds.sensor?.name}</span>
                              <span className="text-gray-400">{ds.sensor?.model}</span>
                              <span className="text-gray-400">SN: {ds.sensor?.serialNumber}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
                {d.notes && <div className="mt-2 pl-7 text-xs text-gray-500">{d.notes}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
