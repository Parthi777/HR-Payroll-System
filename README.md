# AI HR Payroll System

Dual-platform AI HR & Payroll: **selfie attendance · GPS geofencing · shift monitor · WhatsApp automation · payroll engine**.

See [CLAUDE.md](CLAUDE.md) for the full specification.

## Monorepo layout

```
ai-hr-payroll/
├── android/    Employee app — Kotlin + Jetpack Compose (Hilt, Retrofit, Room, CameraX, ML Kit)
├── web/        Master Control — Next.js 14 + TypeScript + Tailwind + shadcn/ui
├── backend/    API — Node 20 + Fastify + TypeScript + Prisma (PostgreSQL) + Redis + BullMQ
├── shared/     Shared TypeScript types (web + backend)
├── docs/       Design docs
├── docker-compose.yml   PostgreSQL + Redis
└── .env.example
```

## Quick start

```bash
# 1. Infra
cp .env.example backend/.env
docker compose up -d            # Postgres + Redis

# 2. Backend
cd backend && npm install
npm run prisma:generate && npm run prisma:migrate -- --name init
npm run db:seed && npm run dev  # http://localhost:3001

# 3. Web
cd ../web && npm install
cp ../.env.example .env.local
npm run dev                     # http://localhost:3000

# 4. Android
# Open android/ in Android Studio, add google-services.json + Maps key, Run.
```

Each package has its own README with details.
