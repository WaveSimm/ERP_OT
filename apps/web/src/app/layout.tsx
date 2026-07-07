import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ERP-OT 프로젝트 관리",
  description: "ERP/OT 프로젝트 관리 시스템",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      {/* FOUC 방지 — 페인트 전에 저장된 테마를 읽어 .dark 를 미리 적용.
          다크로 설정한 사용자만 영향(새로고침 시 흰 번쩍임 제거). 라이트/미설정 사용자엔 무영향. */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('erp-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      {/* Suspense 경계 — useSearchParams 등 CSR 훅을 쓰는 페이지의 정적 빌드 오류 방지 (전역 1회) */}
      <body className="bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100 min-h-screen">
        <Suspense fallback={null}>{children}</Suspense>
      </body>
    </html>
  );
}
