# Backend — AI HR Payroll API

Fastify + TypeScript + Prisma (PostgreSQL) + Redis + BullMQ + Socket.io.

## Setup

```bash
cp ../.env.example .env       # fill in values
npm install
docker compose -f ../docker-compose.yml up -d   # Postgres + Redis
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run db:seed
npm run dev
```

API runs at `http://localhost:3001`. Health check: `GET /api/health`.

## Structure

```
src/
├── config/        env validation (zod)
├── plugins/       fastify plugins (prisma)
├── middleware/    auth (jwt + rbac), errorHandler
├── routes/        route modules per domain
├── services/      business logic (geofence, payroll, whatsapp, ai)
├── utils/         logger (pino), AppError
└── server.ts      entrypoint
```

## Conventions (see ../CLAUDE.md)

- Controllers/routes are thin — logic lives in `services/`.
- Every route validates input with **Zod**.
- Errors thrown as `AppError(message, statusCode)`, caught by the global handler.
- Structured logging via **pino** (no `console.log`).
- WhatsApp sends always go through the **BullMQ** queue.
