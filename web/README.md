# Web — Master Control Web App

Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui.

## Setup

```bash
cp ../.env.example .env.local   # set NEXT_PUBLIC_API_URL etc.
npm install
npm run dev
```

App runs at `http://localhost:3000`.

## Structure

```
src/
├── app/
│   ├── (dashboard)/      admin shell + module pages
│   │   ├── layout.tsx    sidebar nav
│   │   ├── dashboard/    real-time overview
│   │   ├── attendance/   live attendance monitor
│   │   ├── employees/    CRUD + face enrollment
│   │   ├── geofence/     map geofence editor
│   │   ├── shifts/  leaves/  payroll/  whatsapp/  reports/  settings/
│   ├── layout.tsx        root layout
│   └── page.tsx          landing
├── components/ui/        shadcn/ui primitives
├── hooks/                useSocket (live feed)
└── lib/                  api client, utils
```

## Conventions (see ../CLAUDE.md)

- Server Components by default; add `"use client"` only when needed.
- Forms: React Hook Form + Zod. Tables: TanStack Table. State: Zustand.
- Real-time via `useSocket` (Socket.io client).
- Add shadcn components with `npx shadcn@latest add <name>`.
