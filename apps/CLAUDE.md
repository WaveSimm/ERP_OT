# apps/ — Frontend Applications

## Apps in this directory

| App | Port | Description |
|-----|------|-------------|
| `web/` | 3000 | Main ERP/OT web application |
| `admin/` | 3010 | Admin panel |

## Tech Stack

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS
- **State Management**: TanStack Query (server state) + Zustand (client state)
- **Components**: shadcn/ui + `packages/ui`
- **API Client**: `packages/api-client`

## File Structure (per app)

```
apps/web/
├── src/
│   ├── app/              # Next.js App Router (pages + layouts)
│   ├── components/       # App-specific components
│   ├── hooks/            # Custom hooks
│   ├── lib/              # Utilities, constants
│   ├── stores/           # Zustand stores
│   └── types/            # App-specific types
├── public/
├── next.config.js
├── tailwind.config.ts
└── package.json
```

## Naming Conventions (Frontend)

- **Components**: PascalCase files and function names (`UserTable.tsx`)
- **Hooks**: camelCase prefixed with `use` (`useUserList.ts`)
- **Stores**: camelCase suffixed with `Store` (`userStore.ts`)
- **Pages**: lowercase with hyphens (Next.js convention: `app/user-management/page.tsx`)

## Rules

1. Server Components by default — add `"use client"` only when needed
2. All API calls via `packages/api-client` — no direct fetch in components
3. Loading/error states required for all async operations
4. No inline styles — Tailwind only
5. Accessibility: semantic HTML + ARIA where needed
6. **날짜 입력은 항상 `<DateInput>` 사용** (`@/components/ui/DateInput`).
   `<input type="date" />` 직접 사용 금지 — Chrome에서 연도가 6자리까지 입력되는 버그 방지.
   default min/max는 1900-01-01 ~ 2100-12-31. 더 좁은 범위 필요 시 props로 override.
7. **시간 입력은 항상 `<TimeInput>` 사용** (`@/components/ui/TimeInput`).
   `<input type="time" />` 직접 사용 금지 — 스타일·step 통일.
   default `step={60}` (1분 단위).
8. **날짜·시간 표시는 `@/lib/datetime` helper 사용**.
   `toLocaleString("ko-KR")` 직접 사용 금지 — locale default가 12h라 "오전/오후" 표시됨.
   - `fmtDate(value)` → "YYYY-MM-DD"
   - `fmtTime24(value)` → "HH:mm" 24h
   - `fmtDateTime24(value, { short? })` → "YYYY-MM-DD HH:mm" 24h

## Common UI Components (`apps/web/src/components/ui/`)

| Component | Purpose | Usage |
|-----------|---------|-------|
| `DateInput` | 날짜 입력 (HTML5 date input wrapper) | `<DateInput value={...} onChange={...} />` — default min/max 1900~2100 |
| `TimeInput` | 시간 입력 (HTML5 time input wrapper) | `<TimeInput value={...} onChange={...} />` — default step=60 (1분) |
| `ContextMenu` | 우클릭 메뉴 | (TBD documentation) |

## Common Helpers (`apps/web/src/lib/`)

| Module | Functions | Purpose |
|--------|-----------|---------|
| `datetime` | `fmtDate`, `fmtTime24`, `fmtDateTime24` | 24h 형식 강제, locale 통일 |
