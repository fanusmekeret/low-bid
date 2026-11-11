# LOW BID API

**Runtime:** Bun 1.2+ with Express 5, Prisma 6, MySQL 8.0.1+, Redis, Socket.IO, BullMQ and sharp.

LOW BID runs **lowest unique bid** auctions:

- **Bidding:** each bid is a secret amount (for example 37.45 ETB) plus a bid fee paid through Chapa. A bid counts once its fee is verified.
- **Winning:** when the auction ends, the lowest amount that exactly one person bid wins. If no amount is unique, the lowest amount wins, and among bids on it the one whose fee was confirmed first.
- **Paying:** the winner pays their bid amount. Bid fees and the winning bid together pay for the item.
- **Secrecy:** amounts stay secret until the close, even from LOW BID staff screens. Then the full ranking is published.
- **One seller:** LOW BID itself writes every listing, sets prices and fees, and delivers every won item. There is no seller portal; staff manage everything under `/api/v1/admin`.

Built so far:
- **Accounts:** authentication (phone and password, SMS OTP, JWT access tokens with rotating refresh tokens), users, roles and permissions, audit logging.
- **Listings:** categories, LOW BID's own product listings with spec sheets and photo uploads, staff-scheduled auctions, order delivery.
- **Platform:** settings and in-app notifications.
- **Auctions:** the lowest-unique-bid engine, Socket.IO live updates, automatic closing.
- **Payments:** Chapa bid fees and winner payments, refunds, and the ledger.

> **Before launch:** paid-entry lowest-unique-bid auctions can be treated as a lottery or game of chance. Confirm the licensing position in Ethiopia (National Lottery Administration) with a lawyer.

## Run it locally

```bash
# 1. Install Bun (https://bun.sh) and Docker Desktop
curl -fsSL https://bun.sh/install | bash

# 2. Install and configure
cd backend
bun install
cp .env.example .env                 # Bun loads .env automatically
# Fill JWT_ACCESS_SECRET and OTP_PEPPER (48+ random chars each):
bun -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# Optional: SUPER_ADMIN_PHONE and SUPER_ADMIN_PASSWORD (12+ chars) to create the first admin

# 3. Create the database schema and seed it
bun run services:up                  # starts MySQL and Redis in Docker and creates the tables
bun run db:seed                      # roles, permissions, categories (with bid fees), settings, super admin
bun run db:seed:demo                 # optional: demo bidders and 22 LOW BID auctions with secret bids

# 4. Start the API
bun run dev                          # http://localhost:4000/healthz (also runs the auction jobs)
```

`bun run dev` first makes sure the MySQL and Redis containers are running, starting them
(and Docker Desktop, on macOS and Windows) if needed, and waits until they are healthy, so you
never have to start them by hand. Data lives in Docker volumes and survives restarts.

- `bun run services:down` stops the containers.
- `SKIP_DOCKER=1 bun run dev` skips Docker, for a MySQL and Redis you run yourself. Docker is also skipped automatically when `DATABASE_URL` and `REDIS_URL` point to another machine.
- If port 3306 or 6379 is already used by a MySQL or Redis installed on your computer, stop that service or use `SKIP_DOCKER=1`.

**Schema changes in development.** Until the first production release the schema is applied
with `prisma db push` (there are no migration files yet). `bun run dev` does this on every start,
so a pulled change that keeps data applies by itself. If a change would delete data (a removed
column or enum value), `bun run dev` stops and asks you to run:

```bash
bun run db:reset    # drops the local database, recreates the tables, clears queued jobs, runs both seeds
```

Before the first production deploy, create the baseline migration with
`bunx prisma migrate dev --name init` and use `bun run db:deploy` on servers from then on.

**What changed in the auction tables** when the app switched to lowest unique bid:
- **Removed:** start price, increment, reserve, deposits and anti-sniping.
- **Added:** item cost, bid fee, bid range and bid status. Seller accounts, documents, payouts and commissions are gone (LOW BID is the only seller).

Run `bun run db:reset` once after pulling these changes.

### Demo logins

There are no built-in passwords: you choose them in `.env` before seeding.

| Who | Phone | Password |
| --- | --- | --- |
| Demo bidders (8 accounts) | `0900000201` … `0900000208` (e.g. `0900000201`, Abebe Kebede) | `DEMO_USER_PASSWORD` from `.env`; if unset, `bun run db:seed:demo` makes a random one and prints it |
| Staff (super admin) | `SUPER_ADMIN_PHONE` from `.env` | `SUPER_ADMIN_PASSWORD` from `.env` (12+ characters), created by `bun run db:seed` |

Demo bidders' phones are already verified, so they can bid straight away. The LOW BID house
account that owns every listing (`+251999000000`) cannot sign in.

Redis is required: it runs the auction start and close jobs and shares live updates between
API processes. To run jobs in their own process, set `RUN_WORKERS=false` on the API and start
`bun run worker` separately.

With `SMS_PROVIDER=console`, OTP messages print in the terminal instead of being sent.

## How a bid works

1. `POST /api/v1/auctions/:id/bids` with `{ amount, idempotencyKey }`. The server checks the range, step, duplicates and the per-person limit. It records the bid as `PENDING_PAYMENT` and returns `{ bid, payment }`, where `payment.checkoutUrl` is Chapa's page for the bid fee.
2. When Chapa confirms the fee (webhook, callback, return page or the app polling `GET /payments/:txRef`), the bid becomes `ACTIVE`. The auction's bid count goes up, and `auction:bid { bidCount }` is broadcast with no amount.
3. Unpaid fees expire and their bids become `VOID`, so the amount can be bid again. A fee paid after the close is refunded automatically.
4. At the end time, the close first gives fees still being confirmed up to `settleWindowMinutes` (5 by default). It then ranks the paid bids and records the winner.
5. If the winner doesn't pay in time, the item is offered to the next bidder in the ranking at their own amount.
6. **Refunds:**
   - If the auction is cancelled, all bid fees are refunded.
   - If an admin set `minPaidBids` and the auction gets fewer paid bids, it ends unsold and all fees are refunded.

**Settings:** the default fee, bid range, step, per-person limit and settle window live in the `auction.lowestUniqueBid` setting. Categories can set their own fee: the seed sets 50 ETB for vehicles and real estate. Admins can change an auction's terms before bidding opens with `PATCH /api/v1/admin/auctions/:id`.

## Tests

```bash
bun run test:unit                    # no database needed

# Integration tests use a separate database and wipe it. Payment tests run against a local fake
# Chapa server (tests/integration/fake-chapa.js); they never call the real Chapa API.
DATABASE_URL="$TEST_DATABASE_URL" bunx prisma db push
TEST_DATABASE_URL=… bun run test:integration   # each file runs in its own Bun process
```

## Endpoints

The full list with request fields and rules is in [`docs/API.md`](../docs/API.md).

## Photos and documents

With `STORAGE_DRIVER=local` (the default), files live under `backend/storage/`:
`public/` for product photos (served at `/media`) and `private/` for private files
(only reachable through 5-minute signed links). Back up this folder with the database.
For S3-compatible storage (Backblaze B2, Wasabi, Cloudflare R2), set `STORAGE_DRIVER=s3`
and the `S3_*` variables, and run `bun install` so the optional AWS SDK is present.

## Chapa payments

1. Create a Chapa account and copy the **test** secret key (Settings → API) into `CHAPA_SECRET_KEY`.
2. In Settings → Webhooks, set the URL to `https://<your-api>/api/v1/payments/chapa/webhook`, set a
   secret hash, and copy it into `CHAPA_WEBHOOK_SECRET`.
3. `API_PUBLIC_URL` must be reachable from the internet for Chapa's callback and webhook. For local
   testing, use a tunnel (for example `cloudflared tunnel --url http://localhost:4000`) and set
   `API_PUBLIC_URL` to the tunnel address.
4. Pay with Chapa's test numbers and cards on the hosted page, and watch the payment move to PAID.
5. Go live: switch to the live key. The server refuses test keys and test-mode payments when
   `NODE_ENV=production`.

Payouts default to manual bank transfer, which finance records with mark-paid. Set
`payout.policy.method` to `CHAPA_TRANSFER` (admin settings) to send them through Chapa transfers,
once transfers are enabled on your Chapa account.

## SMS through Ethio Telecom

`src/services/sms/providers/ethiotelecom.js` sends over HTTP. Ethio Telecom issues an interface
document with each enterprise SMS account; match the request fields in `buildRequest` to it before
going live, then set `SMS_PROVIDER=ethiotelecom` and the `ETHIOTELECOM_SMS_*` variables. If the
account is SMPP-only, replace that file with an SMPP provider exposing the same `{ name, send }`.

## Money

All amounts are integer santim (`BigInt`, 1 ETB = 100). The API returns them as strings. See
`src/utils/money.js`.
