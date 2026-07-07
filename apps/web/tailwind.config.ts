import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#2563eb", dark: "#1d4ed8", light: "#dbeafe" },
      },
    },
  },
  // typography: 게시판/작업비고 마크다운 뷰(prose 클래스)에 필수 — 없으면 렌더가 일반 텍스트처럼 보임
  plugins: [typography],
};

export default config;
