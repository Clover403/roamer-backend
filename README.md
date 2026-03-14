# Roamer Backend

Express + Socket.IO + Prisma + PostgreSQL backend initialization for Roamer.

## Stack
- Express.js (REST API)
- Socket.IO (realtime chat)
- PostgreSQL (local)
- Prisma ORM
- TypeScript

## Project scripts
- `npm run dev` → start dev server with watch
- `npm run build` → compile TypeScript
- `npm run start` → run compiled server
- `npm run prisma:validate` → validate Prisma schema
- `npm run prisma:generate` → generate Prisma client
- `npm run prisma:migrate` → create/apply migrations (dev)

## Setup
1. Copy `.env.example` to `.env`
2. Ensure local PostgreSQL is running and database exists
3. Run:
   - `npm install`
   - `npm run prisma:generate`
   - `npm run prisma:migrate`
   - `npm run dev`

## Healthcheck
- `GET /`
- `GET /api/health`

## Socket events (initial)
- `chat:join` with `{ conversationId }`
- `chat:message` with `{ conversationId, content, senderId }`

## Notes
- Auth login/register is implemented with `bcrypt` + `JWT` and stored in `httpOnly` cookie.
- Prisma schema already covers users/roles/identity verification, complex listings, groups/offers/contracts, rentals, chat, notifications, promotions, garage, analytics.

## Controller Architecture
- `src/routes` only defines endpoint mapping.
- `src/controllers` contains business logic + payload validation.
- Shared dashboard range helper lives in `src/controllers/dashboard.utils.ts`.

## Documentation for Team / AI Copilot
- Project context: [docs/PROJECT_CONTEXT_FOR_DEVS_AND_COPILOT.md](docs/PROJECT_CONTEXT_FOR_DEVS_AND_COPILOT.md)
- API + controller map: [docs/API_REFERENCE_CONTROLLERS.md](docs/API_REFERENCE_CONTROLLERS.md)
# roamer-backend
