# LOW BID API reference

Base URL: `/api/v1`. All bodies are JSON unless marked **multipart**.

- Success: `{ "data": ..., "meta"?: ... }`
- Error: `{ "error": { "code": "PRODUCT_NEEDS_IMAGES", "message": "...", "details"?: ... } }`. The apps translate by `code`.
- Auth: `Authorization: Bearer <accessToken>`. Access tokens last 15 minutes; refresh with `POST /auth/refresh`.
- Money: `{ "minor": "16400000", "etb": "164000.00", "currency": "ETB" }`. `minor` is santim (1 ETB = 100).
- Every response carries `X-Server-Time` (epoch ms) for countdown clocks.

Status: phases 2–6. **LOW BID is the only seller:** staff write every listing, schedule every auction and deliver every won item; there is no seller portal. Auctions are **lowest unique bid**: each bid is a secret amount plus a bid fee paid through Chapa; at the close the lowest amount that exactly one person bid wins (if none is unique, the lowest amount, earliest confirmed fee). Runtime: Bun.

---

## Auth

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | /auth/register | `phone, password, firstName, lastName, email?, locale?` | Sends a verification SMS |
| POST | /auth/login | `phone, password` | |
| POST | /auth/refresh | `refreshToken` | Rotates; reusing an old token signs out every device in that session family |
| POST | /auth/logout | `refreshToken?` | |
| POST | /auth/logout-all | — | Signed in |
| POST | /auth/otp/send | — | Resend phone verification |
| POST | /auth/otp/verify | `code` | Grants the bidder role; returns a new access token |
| POST | /auth/password/forgot | `phone` | Same reply whether or not the number exists |
| POST | /auth/password/reset | `phone, code, newPassword` | Signs out all devices |

## Me and notifications

| Method | Path | Notes |
| --- | --- | --- |
| GET, PATCH | /me | `firstName, lastName, email, locale` |
| POST | /me/password | `currentPassword, newPassword` |
| POST | /me/devices | `fcmToken, platform (ANDROID, IOS, WEB), appVersion?` |
| DELETE | /me/devices/:fcmToken | |
| GET | /notifications?unread=true&cursor=&limit= | Text in the user's language; `meta.unreadCount`, `meta.nextCursor` |
| POST | /notifications/:id/read | |
| POST | /notifications/read-all | |

## Categories

| Method | Path | Access |
| --- | --- | --- |
| GET | /categories | Public. Active categories as a tree, with `nameEn`, `nameAm`, `defaultBidFee` (0 = platform default) |
| GET | /admin/categories | `category:manage`. Includes inactive ones and `productCount` |
| POST | /admin/categories | `slug, nameEn, nameAm, parentId?, iconKey?, sortOrder?, isActive?, defaultBidFeeEtb?` |
| PATCH | /admin/categories/:id | Any of the above |
| DELETE | /admin/categories/:id | Only if empty; otherwise `CATEGORY_IN_USE`, so deactivate instead |

Categories are at most two levels deep. Products go in a category with no active subcategories.

## Admin: listings (LOW BID's own)

| Method | Path | Notes (permission `product:manage`) |
| --- | --- | --- |
| GET | /admin/products?status=&categoryId=&q= | `status`: DRAFT, APPROVED (published), ARCHIVED. Archived listings hidden unless asked for |
| POST | /admin/products | `categoryId, title, description, condition, location, attributes` creates a DRAFT owned by LOW BID |
| GET | /admin/products/:id | |
| PATCH | /admin/products/:id | Refused while an auction is scheduled or live, or once sold (`lockedReason`) |
| DELETE | /admin/products/:id | Drafts without history are deleted; anything else is archived. Returns `{ mode }` |
| POST | /admin/products/:id/images | **multipart**: up to 10 files in `images`. All-or-nothing; a bad file returns `details.fileIndex` |
| PUT | /admin/products/:id/images/order | `imageIds` must list every photo exactly once |
| DELETE | /admin/products/:id/images/:imageId | |
| POST | /admin/products/:id/publish | DRAFT → APPROVED (published). Needs at least `listing.rules.minImagesToSubmit` photos |
| POST | /admin/products/:id/archive | `reason`. Refused while an auction is scheduled or live |

`attributes` is the spec sheet:

```json
{
  "highlights": ["256GB", "6.7\" 120 Hz OLED", "Battery 94%"],
  "specs": [
    { "group": "Display", "rows": [{ "label": "Size", "value": "6.7 inch" }] }
  ]
}
```

- Highlights (up to 3) appear on auction cards; cards never show prices.
- Titles and spec sheets containing ETB, birr or ብር are rejected.

Photos are re-encoded to WebP at 320, 800 and 1600 px wide (`urls.sm`, `urls.md`, `urls.lg`). This strips EXIF data such as GPS location and rotates photos upright. The shortest side must be at least 400 px. iPhone HEIC photos are rejected with `IMAGE_FORMAT_UNSUPPORTED`.

## Browsing (public)

| Method | Path | Notes |
| --- | --- | --- |
| GET | /home | Rails: `banners, featured, endingSoon` (within 1 hour), `live` (most bids), `upcoming, recentlyAdded, popularCategories`. Cached 10–15 s |
| GET | /auctions?status=&category=&q=&condition=&featured=true&sort=&page=&pageSize= | `status`: open (default), live, upcoming, ended (last 30 days). `sort`: ending_soon, newest, most_bids, starting_soon. `category` includes subcategories. `q` matches title and description (English and Amharic) |
| GET | /auctions/:id | Auction page: `bidding` (`bidFee, minBid, maxBid, bidStep, maxBidsPerUser, minPaidBids`), `marketValue`, full spec sheet, all photos, seller. After the close: `result` (`outcome, finalPrice, winnerAlias, paidBids, uniqueBids`). Signed-in viewers also get `viewer` (`isWatching, myBidCount, myPendingCount, myStatus`). **No bid amounts while bidding is open** |
| GET | /auctions/:id/bids?cursor=&limit= | **Only after the close** (before: `403 BIDS_SECRET`). Every paid bid in ranking order: `rank, amount, unique, isWinning, bidderAlias, isYou`. Names masked (`A***e · 7F3C`, the tag stable within one auction only) |
| GET | /auctions/:id/bids/mine | Signed in. My own bids on this auction: `amount, status (PENDING_PAYMENT, ACTIVE), txRef, checkoutUrl` (to finish paying a fee) |

List endpoints return **cards**: title, highlights, condition, location, cover photo, bid count, `startsAt`, `endsAt`. **Cards never include prices.**

## Bidding

| Method | Path | Body |
| --- | --- | --- |
| POST | /auctions/:id/bids | `amount` (birr as a string, e.g. "37.45"; secret until the close), `idempotencyKey` (a new UUID per bid) |

Requires a verified phone (bidder role). Returns `201` with `{ bid: { id, amount, status: PENDING_PAYMENT }, payment: { txRef, checkoutUrl, amount (the bid fee), status } }`. Open `checkoutUrl` to pay the fee; the bid counts (`ACTIVE`) only once the server has verified the fee with Chapa. Sending the same `idempotencyKey` again returns `200` with the original bid, its checkout and `replay: true`.

The checks run inside a MySQL transaction holding the auction row lock, against the database clock.

| Error code | HTTP | Meaning |
| --- | --- | --- |
| AUCTION_NOT_STARTED | 409 | `details.startsAt` |
| AUCTION_ENDED | 409 | Closed, cancelled, or the end time passed |
| BID_OUT_OF_RANGE | 400 | `details.minBid, details.maxBid` |
| BID_STEP_INVALID | 400 | Not a multiple of `details.bidStep` |
| DUPLICATE_BID_AMOUNT | 409 | You already bid this amount (paid or awaiting payment) |
| BID_LIMIT_REACHED | 409 | `details.maxBidsPerUser` |
| BIDDING_BLOCKED | 403 | Too many unpaid wins |
| PAYMENT_INIT_FAILED | 502 | Chapa could not start the fee checkout; the bid is voided, so the amount can be tried again |
| RATE_LIMITED | 429 | More than 10 bids in 10 seconds |

Bid states: `PENDING_PAYMENT` → `ACTIVE` (fee verified) or `VOID` (fee failed, expired, or paid after the close; a late fee is refunded automatically). There is no anti-sniping: bids are secret, so the end time is fixed.

## My auctions

| Method | Path | Notes |
| --- | --- | --- |
| GET | /me/bids?status=active\|ended | Cards with `myStatus`: BIDDING (while open: nobody learns where they stand), WON, LOST, CANCELLED |
| GET | /me/auctions/won | Cards plus `result`: `totalDue, paymentDeadline, status, paidAt, txRef` (txRef of the paid checkout, for receipts and refund requests) |
| GET | /me/auctions/lost | Cards |
| GET | /me/watchlist?status=active\|ended | Cards |
| POST, DELETE | /auctions/:id/watch | |

## Admin: auctions and bids

| Method | Path | Permission |
| --- | --- | --- |
| GET | /admin/auctions?status=&q= | `auction:manage` |
| POST | /admin/auctions | `auction:manage`. `productId` (a published listing), `itemCost` (what the item costs LOW BID, at least 100 ETB; also the default highest bid), `marketValue?`, `startsAt` (ISO; now or up to a minute ago = start immediately), `durationMinutes` (1 hour to 30 days), `isFeatured?`, and optional terms `bidFee, minBid, maxBid, bidStep, minPaidBids, maxBidsPerUser`. Defaults: the category's bid fee (or the platform's 10 ETB), bids from 0.01 ETB up to the item cost. No approval step: it is SCHEDULED (or LIVE) at once |
| GET | /admin/auctions/:id | `auction:manage`. Item cost, terms, `bidCount`, `feesCollected`, `grossTakings` (fees + winning bid) and result. Never bid amounts while bidding is open |
| POST | /admin/auctions/:id/cancel | `auction:cancel`; `reason`. Works on live auctions; bidders and watchers are told |
| PATCH | /admin/auctions/:id | `auction:manage`. `isFeatured`; bidding terms `bidFee, minBid, maxBid, bidStep` (ETB strings), `minPaidBids, maxBidsPerUser` (only before bidding opens) |
| GET | /admin/bids?auctionId=&userId= | `bid:monitor`. Real bidder identities, amounts, status and IP, for fraud review. Treat as confidential while auctions are open |

## Live updates (Socket.IO)

Connect to namespace `/live` (path `/socket.io`). Send `auth: { token }` to receive personal events; guests can watch auctions. Every event carries `serverTime` (epoch ms).

| Direction | Event | Payload |
| --- | --- | --- |
| client → server | `auction:join` / `auction:leave` | `{ auctionId }`, ack `{ ok, serverTime }`. Up to 40 rooms per connection |
| client → server | `time:sync` | ack `{ ok, serverTime }` |
| server → auction room | `auction:bid` | `auctionId, bidCount` (a fee was confirmed; never an amount) |
| server → auction room | `auction:started` | `auctionId, endsAt` |
| server → auction room | `auction:closed` | `auctionId, outcome (SOLD, NO_BIDS, NOT_ENOUGH_BIDS), finalPrice, winnerAlias, paidBids, uniqueBids` |
| server → auction room | `auction:cancelled` | `auctionId, reason` |
| server → user | `user:won` | `auctionId, totalDue, paymentDeadline, secondChance?` |
| server → user | `payment:updated` | `txRef, status, purpose, auctionId, bidId?, bidStatus?, receiptNo?, refunding?` |

Clients cannot send bids over the socket. An invalid token fails the connection with `AUTH_TOKEN_INVALID`; refresh the token and reconnect.

## Auction lifecycle

`PENDING_APPROVAL` → (admin approves) → `SCHEDULED` → (start time) → `LIVE` → (end time) → `CLOSED`, or `CANCELLED` at any point before closing.

Closing:
1. Fees still being confirmed at the end time get up to `settleWindowMinutes` (5): the close checks them with Chapa and retries every 30 seconds until they settle or the window ends. Bids still unpaid after that become `VOID`.
2. Paid bids are ranked: unique amounts lowest first, then the rest lowest first (earliest confirmed fee first within an amount). The first bidder whose account is still active wins and pays their own amount.
3. Fewer paid bids than `minPaidBids` → `NOT_ENOUGH_BIDS`, every fee refunded.
4. The result gets a payment deadline (48 hours by default); the winner and the other bidders are notified, and the full ranking becomes public.

Delayed jobs fire at the exact start and end times; a sweep every 30 seconds catches anything missed.

## Payments (Chapa)

All amounts are computed by the server. The app never sends a price, and the Chapa secret key never leaves the server.

| Method | Path | Notes |
| --- | --- | --- |
| POST | /payments/checkout | `auctionId`. Winner only, before the payment deadline. Amount = the winning bid (+ buyer premium, 0 by default). Bid fees are started by `POST /auctions/:id/bids` |
| GET | /payments/:txRef | Status: INITIATED, PENDING, PAID, FAILED, EXPIRED, REFUNDED, PARTIALLY_REFUNDED. While pending it re-checks Chapa (at most every 5 s), so the app can poll it after the checkout closes |
| GET | /payments?page= | My payment history |
| GET | /payments/:txRef/receipt?format=json\|html | Once paid. The HTML version prints or saves as PDF from the app |
| POST | /payments/:txRef/refund-request | `reason`. Winner, any time before delivery and within the dispute window (3 days) after it, unless they confirmed receipt. Staff decide |
| POST | /me/auctions/:id/confirm-received | Winner confirms the item arrived as described (closes refund requests) |

### How a payment is confirmed

1. The app opens `checkoutUrl` in an in-app browser (Chrome Custom Tab / SFSafariViewController).
2. The buyer pays on Chapa's page (telebirr, CBE Birr, cards, bank).
3. Any of these makes the server call Chapa's verify API (`GET /v1/transaction/verify/:tx_ref`):
   - the webhook (`POST /payments/chapa/webhook`)
   - the callback (`GET /payments/chapa/callback`)
   - the return page (`GET /payments/chapa/return`)
   - app polling
   - the reconcile job every 10 minutes
4. The payment becomes PAID only if Chapa reports `success` **and** the `tx_ref`, the currency (ETB) and the exact amount match. In production it must also be a live-mode payment. Anything else is recorded as `FAILED` with `NEEDS_REVIEW: …` for an admin.
5. Settlement runs once, inside a transaction holding the payment row lock:
   - receipt number and ledger entries
   - the order joins the staff delivery list (`GET /admin/orders`)
   - a notification to the buyer
   - a `payment:updated` socket event to the buyer

Webhooks are stored and deduplicated before processing. Signed with an invalid signature → 401 and ignored. Chapa's `x-chapa-signature` (HMAC-SHA256 of the payload) and `chapa-signature` (HMAC-SHA256 of the secret) are both accepted, using `CHAPA_WEBHOOK_SECRET`.

### Edge cases handled

| Situation | What happens |
| --- | --- |
| Buyer taps Pay twice | The same open checkout is returned |
| Webhook, callback and polling arrive together | The first settles; the others find it already paid |
| Paid a different amount, currency, or a test payment in production | Not fulfilled; flagged NEEDS_REVIEW |
| Bid fee paid after the close (or for a cancelled auction, or after its checkout expired) | Bid voided, fee refunded automatically |
| Bid fee paid in the last seconds, confirmed just after the end | Counted: the close waits up to `settleWindowMinutes` for fees still being confirmed |
| Winner pays after the deadline passed or the offer moved to another bidder | Payment kept in escrow and refunded in full automatically |
| Winner never pays | At the deadline: payment strike. The item is offered to the next bidder in the ranking at their own amount, with a new 48-hour deadline; otherwise it ends unsold. A checkout still open at the deadline gets a grace period |
| Auction cancelled, or too few paid bids | Every paid bid fee is refunded through Chapa |
| Losing bidders | Bid fees are not refunded (they are the price of taking part) |
| Checkout never completed | Marked EXPIRED 10 minutes after it lapses; still re-checked for 24 hours in case Chapa completes it late |

## Admin: payments, refunds, orders

| Method | Path | Permission |
| --- | --- | --- |
| GET | /admin/payments?status=&purpose=&needsReview=true&q= | `payment:view` |
| GET | /admin/payments/:id | `payment:view`. Includes Chapa's verify response, webhooks, refunds and ledger lines |
| POST | /admin/payments/:id/reconcile | `payment:reconcile`. Re-checks with Chapa now |
| POST | /admin/payments/:id/refunds | `refund:manage`. `amount?` (ETB, default: everything refundable), `reason` |
| GET | /admin/refunds?status=&kind= | `refund:manage` |
| POST | /admin/refunds/:id/approve, /reject | `refund:manage`. For buyer requests; reject takes `reason` |
| POST | /admin/refunds/:id/retry | `refund:manage`. Failed refunds, with a new reference |
| POST | /admin/refunds/:id/mark-processed | `refund:manage`. `providerRef`; for refunds paid manually or confirmed on the Chapa dashboard |
| GET | /admin/orders?status=PAID | `order:fulfil`. Won items by status (default PAID: waiting for LOW BID to deliver), with the winner's name and phone |
| POST | /admin/orders/:id/delivered | `order:fulfil`. `note?`. PAID → FULFILLED; tells the winner, who then has the dispute window to report a problem |
| GET | /admin/ledger/balances | `report:view`. Per-account balances; `balanced` must always be true |

Refunds go through Chapa's refund API (`POST /v1/refund/:tx_ref`, confirmed with `GET /v1/refund/:ref_id/verify`). Each refund carries our own unique reference, so a retry cannot refund twice. Set `payment.chapa.refundMode` to `MANUAL` to pay refunds yourself and record them with mark-processed.

### Ledger

Every money movement is a balanced double-entry group in `transactions`. Accounts:
- `EXTERNAL`: outside LOW BID
- `ESCROW`
- `PLATFORM_REVENUE`
- `PROVIDER_FEES`: Chapa's charge, absorbed by the platform

Bid fees go to platform revenue (refunds come back out of it). A sale moves the winner's cash into escrow and on to platform revenue. Compare an auction's `grossTakings` (fees + winning bid) with its `itemCost` to see whether it paid for the item.

## Admin: users and settings

| Method | Path | Permission |
| --- | --- | --- |
| GET | /admin/roles | `user:view` |
| GET | /admin/users?q=&status=&role= | `user:view` |
| GET | /admin/users/:id | `user:view` |
| PATCH | /admin/users/:id/status | `user:manage`. `status, reason` |
| POST | /admin/users/:id/roles | `role:assign`. `role` |
| DELETE | /admin/users/:id/roles/:role | `role:assign` |
| GET | /admin/settings | `settings:manage` |
| PUT | /admin/settings/:key | `settings:manage`. `{ value: {...} }`, validated per key |

Setting keys: `fees`, `auction.lowestUniqueBid` (`defaultBidFeeMinor, minBidMinor, bidStepMinor, maxBidsPerUser, settleWindowMinutes, refundFeesOnCancel`), `auction.rules`, `listing.rules`, `payment.chapa`, `orders.policy`.

## Files

| Path | Notes |
| --- | --- |
| /media/products/... | Public product photos (local storage). Cached for a year |
| /api/v1/files/private/:token | Private files via a signed 5-minute link. `no-store`, sandboxed |

With `STORAGE_DRIVER=s3`, photo URLs point at `PUBLIC_MEDIA_BASE_URL` and document links are S3 presigned URLs.
