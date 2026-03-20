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
