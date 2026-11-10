# low-bid
the unique lowest bid wins

LOW BID is an Ethiopian online auction marketplace: a Node.js modular monolith, MySQL 8, Redis,
a Flutter buyer/seller app and a Flutter Web admin, with Chapa payments. The backend is the only
authority on bids, winners and payments; clients only display what the server decides.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Prisma schema (27 tables), migrations, seed | ✅ done |
| 2 | Config, auth (register, OTP, login, refresh rotation, reset), RBAC | ✅ done |
| 3 | Sellers, categories, products + spec sheets | ✅ core done (image upload pipeline pending) |
| 4 | Auctions, bid engine, Socket.IO, start/close jobs, sweeper | ✅ done |
| 5 | Chapa checkout, webhook, verify, ledger, reconcile, bid deposits | ⏳ next |
| 6–7 | Flutter mobile app, Flutter Web admin | ⏳ |
| 8–10 | FCM, SMS provider, reports, load/security testing, deployment | ⏳ |

## Layout

```
backend/
  prisma/schema.prisma      # 27 tables, money as BIGINT santim
  prisma/migrations/        # Prisma migrations
  prisma/seed.ts            # roles, permissions, bilingual categories, super admin
  src/config/               # Zod-validated env
  src/middleware/           # auth (JWT), rbac, validate, rate limit, errors
  src/modules/
    auth/                   # register, OTP, login, refresh rotation with reuse detection
    auctions/               # catalog, home rails, watchlist, lifecycle (start/close/sweep)
    bids/                   # rules.ts (pure) + service.ts (SELECT … FOR UPDATE transaction)
    sellers/ admin/ categories/ notifications/ audit/ settings/
  src/sockets/realtime.ts   # Socket.IO /live namespace + Redis adapter/emitter
  src/jobs/queues.ts        # BullMQ start/close jobs
  src/server.ts             # web process (REST + sockets)
  src/worker.ts             # job process (start, close, 30 s sweeper)
  tests/                    # unit tests + MySQL integration tests
docker-compose.yml          # MySQL 8 + Redis for local development
```

## Run locally

```bash
docker compose up -d
cd backend
cp .env.example .env        # then set real secrets
npm install
npx prisma migrate dev
SEED_ADMIN_PASSWORD='choose-a-strong-one' npx prisma db seed
npm run dev                 # API on :4000
npm run dev:worker          # in a second terminal
```

Tests:

```bash
npm test                     # unit tests
RUN_DB_TESTS=1 npm test      # + integration tests against MySQL/Redis
```

The integration suite fires 50 simultaneous bids at one auction and checks that exactly one wins per
price level, plus idempotent retries, anti-sniping extension, and idempotent closing.

## Key rules implemented

- **Money** is integer santim (`BIGINT`); the API returns `{ amount: "50000.00", amount_minor: "5000000", currency: "ETB" }`.
- **Bids** go through `POST /api/v1/auctions/:id/bids { amount_minor, idempotency_key }`. Each bid locks the auction
  row, validates against the DB clock (`NOW(3)`), writes, commits, then broadcasts.
- **Anti-sniping**: a bid in the last 120 s pushes the end to now + 120 s (max 15 extensions; both are settings).
- **Closing**: a delayed BullMQ job per end time plus a 30 s sweeper; closing is idempotent and checks the reserve.
- **Cards never show prices**; prices and the grouped spec sheet are on the auction page only. Specs/headlines
  mentioning ETB, birr or ብር are rejected.
- **Platform fee** 10% seller commission, buyer premium 0% (settings). Deposits are required for Vehicles and
  Real estate (50 ETB default); until Chapa deposits land in phase 5, those auctions refuse bids.
- **Socket.IO** namespace `/live`: `auction:join/leave` in; `auction:bid`, `auction:extended`, `auction:closed`,
  `user:outbid`, `user:won`, `notification:new` out. Bidders are shown masked (`A***e 54`).
