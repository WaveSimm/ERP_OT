"use client";

import { useEffect, useState } from "react";
import { getUser, myProfileApi } from "@/lib/api";

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

export default function HomeHero() {
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");

  useEffect(() => {
    const u = getUser();
    if (u) setName(u.name);
    myProfileApi
      .get()
      .then((p: any) => {
        setDepartment(p?.profile?.departmentName ?? "");
      })
      .catch(() => {});
  }, []);

  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")} (${WEEKDAY_KO[today.getDay()]})`;

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl px-6 py-5 mb-5">
      <h1 className="text-xl font-bold text-gray-900">
        안녕하세요, <span className="text-blue-700">{name || "사용자"}</span>님 👋
      </h1>
      <p className="text-sm text-gray-600 mt-1">
        {dateStr}
        {department && <span className="text-gray-500"> · {department}</span>}
      </p>
    </div>
  );
}
