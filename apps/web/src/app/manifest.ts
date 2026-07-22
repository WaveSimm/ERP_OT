import type { MetadataRoute } from "next";

// PWA 웹 매니페스트 — Next가 /manifest.webmanifest 로 서빙하고 <link rel="manifest">를 자동 삽입.
// 설치형(standalone) 앱으로 홈화면에 추가되며, HTTPS + 서비스워커(public/sw.js) 조건에서 안드로이드 설치 프롬프트가 뜬다.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ERP-OT 프로젝트 관리",
    short_name: "ERP-OT",
    description: "ERP/OT 프로젝트 관리 시스템",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f9fafb",
    theme_color: "#2563eb",
    lang: "ko",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
