import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ERP-OT 프로젝트 관리",
  description: "ERP/OT 프로젝트 관리 시스템",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      {/* Suspense 경계 — useSearchParams 등 CSR 훅을 쓰는 페이지의 정적 빌드 오류 방지 (전역 1회) */}
      <body className="bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100 min-h-screen">
        <Suspense fallback={null}>{children}</Suspense>
      </body>
    </html>
  );
}
