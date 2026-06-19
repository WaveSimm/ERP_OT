import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

// 모노레포 공용 flat config (eslint 9+/typescript-eslint 8).
//   타입미인지(recommended) 기준 — 빠르고 도입 부담 낮음. 추후 룰 점진 강화.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/*.config.js",
      "**/*.config.mjs",
      "**/*.config.cjs",
      "**/*.config.ts",
      "**/prisma/seed.ts",
      "scripts/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 미사용 eslint-disable 지시문은 경고(에러 아님) — 기존 stale 주석으로 CI 막지 않게
    linterOptions: { reportUnusedDisableDirectives: "warn" },
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // TS 컴파일러가 미정의 변수를 검사하므로 no-undef 비활성(typescript-eslint 권장)
      "no-undef": "off",
      // [도입 베이스라인] any 정정은 별도 작업(Phase 2 점진 타이핑) — 지금은 비활성, 추후 warn→error ratchet
      "@typescript-eslint/no-explicit-any": "off",
      // 다수 존재하는 부채 룰은 경고(비차단·가시화)로 두고 점진 수정
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "no-empty": "warn",
      // 도입 베이스라인: 잔여 소수 룰도 warn (추후 ratchet)
      "no-useless-escape": "warn",
      "no-useless-assignment": "warn",
      "prefer-const": "warn",
    },
  },
  // React 훅 룰(web 전체 — .ts 커스텀 훅 포함) — exhaustive-deps 등. 도입 단계라 warn.
  {
    files: ["apps/web/**/*.{js,jsx,ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "warn",
    },
  },
);
