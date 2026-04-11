"use client";

import { useState, useEffect, useRef } from "react";
import { inventoryApi, repairApi, userManagementApi } from "@/lib/api";

interface LocationItem {
  id: string;
  name: string;
  description?: string;
  type: "WAREHOUSE" | "CUSTOMER" | "EMPLOYEE";
}

interface LocationSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

export default function LocationSelect({ value, onChange, className = "", placeholder = "위치 선택..." }: LocationSelectProps) {
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [filtered, setFiltered] = useState<LocationItem[]>([]);
  const [search, setSearch] = useState(value);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loaded) return;
    // 창고(StorageLocation) + 고객사(Customer) + 사원(User) 세 DB에서 병렬 로드
    Promise.all([
      inventoryApi.getLocations({ limit: 9999 }).then(res =>
        res.items.map((l: any) => ({ id: l.id, name: l.name, description: l.description, type: "WAREHOUSE" as const }))
      ).catch(() => []),
      repairApi.getCustomers({ limit: 9999 }).then((res: any) => {
        const list = res.items || res.data || res || [];
        return (Array.isArray(list) ? list : []).map((c: any) => ({
          id: c.id,
          name: c.name,
          description: c.address || c.contactPerson || undefined,
          type: "CUSTOMER" as const,
        }));
      }).catch(() => []),
      userManagementApi.members(true).then((members) =>
        members.map((m) => ({ id: m.id, name: m.name, description: undefined, type: "EMPLOYEE" as const }))
      ).catch(() => []),
    ]).then(([warehouses, customers, employees]) => {
      const all = [...warehouses, ...customers, ...employees];
      setLocations(all);
      setFiltered(all);
      setLoaded(true);
    });
  }, [loaded]);

  useEffect(() => { setSearch(value); }, [value]);

  useEffect(() => {
    if (!search.trim()) { setFiltered(locations); return; }
    const q = search.toLowerCase();
    setFiltered(locations.filter(l => l.name.toLowerCase().includes(q) || (l.description || "").toLowerCase().includes(q)));
  }, [search, locations]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (name: string) => {
    onChange(name);
    setSearch(name);
    setOpen(false);
  };

  // Group by type
  const warehouses = filtered.filter(l => l.type === "WAREHOUSE");
  const customers = filtered.filter(l => l.type === "CUSTOMER");
  const employees = filtered.filter(l => l.type === "EMPLOYEE");

  return (
    <div ref={ref} className="relative">
      <input
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={`w-full border rounded px-3 py-1.5 text-sm ${className}`}
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {warehouses.length > 0 && (
            <>
              <div className="px-3 py-1 text-xs font-semibold text-blue-600 bg-blue-50 sticky top-0">창고</div>
              {warehouses.map((l) => (
                <button key={l.id} onClick={() => handleSelect(l.name)}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 ${l.name === value ? "bg-blue-50 font-medium" : ""}`}>
                  {l.name}
                  {l.description && <span className="text-gray-400 text-xs ml-2">{l.description}</span>}
                </button>
              ))}
            </>
          )}
          {customers.length > 0 && (
            <>
              <div className="px-3 py-1 text-xs font-semibold text-purple-600 bg-purple-50 sticky top-0">고객사</div>
              {customers.map((l) => (
                <button key={l.id} onClick={() => handleSelect(l.name)}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-purple-50 ${l.name === value ? "bg-purple-50 font-medium" : ""}`}>
                  {l.name}
                  {l.description && <span className="text-gray-400 text-xs ml-2">{l.description}</span>}
                </button>
              ))}
            </>
          )}
          {employees.length > 0 && (
            <>
              <div className="px-3 py-1 text-xs font-semibold text-green-600 bg-green-50 sticky top-0">사원</div>
              {employees.map((l) => (
                <button key={l.id} onClick={() => handleSelect(l.name)}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-green-50 ${l.name === value ? "bg-green-50 font-medium" : ""}`}>
                  {l.name}
                </button>
              ))}
            </>
          )}
          {warehouses.length === 0 && customers.length === 0 && employees.length === 0 && (
            <div className="px-3 py-4 text-center text-gray-400 text-sm">결과 없음</div>
          )}
        </div>
      )}
    </div>
  );
}
