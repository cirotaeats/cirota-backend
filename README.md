# Cirota Tiffin Subscription — Production Backend

Deployable REST API and backend services for **Cirota**, a tiffin (meal) subscription service in Ranchi, India.

---

## 1. System Overview

- **Customer PWA** (`https://cirota.in`): Subscribes (or buys a single-tiffin trial), pauses meals, checks remaining tiffins, modifies orders, pays via Razorpay.
- **Admin PWA** (`https://admin.cirota.in`): Delivery sheets, kitchen prep summaries, customer balance overrides, dues management, delivery partner management, and Google Sheets sync.
- **Delivery Partner PWA** (`https://delivery.cirota.in`): Riders log in with Phone + PIN and see only their own route's assigned tiffins for today, with one-tap mark-delivered.
- **Source of Truth**: PostgreSQL (Railway / Render managed Postgres).
- **Google Sheets Mirror**: One-way async sync (Postgres → Google Sheets) preserving the owner's familiar Master Sheet and Daily Sheet views without bottlenecking API throughput.

---

## 2. Tech Stack

- **Runtime**: Node.js (v20+) + Express.js
- **Database & ORM**: PostgreSQL + Prisma ORM
- **Authentication**: Phone + 6-digit OTP (MSG91 / Mock dev mode) for Customers, JWT + bcrypt for Admin, Phone + PIN (bcrypt) for Delivery Partners
- **Payment Processing**: Razorpay Orders API + Webhook HMAC-SHA256 signature verification inside atomic PostgreSQL transactions
- **Push Notifications**: Web Push protocol (`web-push`, VAPID keys) with automatic 410 dead-subscription cleanup
- **Google Sheets Sync**: Google Sheets API v4 (`googleapis`) with exponential backoff retries (`withRetry`)
- **Background Cron Jobs**: `node-cron` for nightly daily order generation, low-balance sweeps, dues reminders, and auto-stop safety nets

---

## 3. Confirmed Menu & Pricing (Seed Data)
_Prices match the official Cirota menu card, effective 01 Aug 2026._

### 4 Base Plan Types:
1. **Veg Lite**:
   - 3 Times: ₹3,200 (90 tiffins) · 2 Times: ₹2,500 (60 tiffins) · 1 Time: ₹1,350 (30 tiffins). One-time trial: ₹50. Validity: 40 days.
2. **Non-Veg Lite**:
   - 3 Times: ₹3,600 (90 tiffins) · 2 Times: ₹2,800 (60 tiffins) · 1 Time: ₹1,500 (30 tiffins). One-time trial: ₹65. Validity: 40 days.
3. **Veg Prime**:
   - 3 Times: ₹4,500 (90 tiffins) · 2 Times: ₹3,500 (60 tiffins) · 1 Time: ₹1,800 (30 tiffins). One-time trial: ₹70. Validity: 45 days.
4. **Non-Veg Prime**:
   - 3 Times: ₹5,100 (90 tiffins) · 2 Times: ₹3,900 (60 tiffins) · 1 Time: ₹2,000 (30 tiffins). One-time trial: ₹90. Validity: 45 days.

### Short Term Plans (Validity-based):
- **30 days** (40/45 days validity), **15 days** (20 days validity), **7 days** (10 days validity) available across all 4 plans — see `prisma/seed.js` for the exact per-tier price grid (also matches the official menu card exactly).
- **Single Tiffin ("Try Once")**: a 1-day, 1-meal order at the plan's trial price above — modeled as a regular `Plan` row (`duration_days: 1`) so it reuses the same subscribe/checkout/tiffin-decrement flow as every other plan, no special-casing needed.

### Add-Ons:
- `+1 Roti` (₹7/pc, ₹210/mo) · `+1 Paratha` (₹10/pc, ₹300/mo) · `+Half Rice` (₹10/plate, ₹300/mo) · `+extra sabzi` (₹20/plate) · `+1pc chicken/egg` (₹25/plate) · `+green salad` (₹10/plate, ₹300/mo)

---

## 4. Environment Variables (`.env`)

Copy `.env.example` to `.env` and populate the values:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection URL (e.g. from Railway) |
| `JWT_SECRET` | Secret key used to sign session JWTs |
| `RAZORPAY_KEY_ID` | Razorpay Key ID (Test/Live) |
| `RAZORPAY_KEY_SECRET` | Razorpay Key Secret |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay Webhook Secret for signature verification |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Single-line JSON string containing Google Service Account credentials |
| `MASTER_SHEET_ID` | Spreadsheet ID for Master Sheet |
| `DAILY_SHEET_ID` | Spreadsheet ID for Daily Sheet |
| `MSG91_AUTH_KEY` | MSG91 API Auth Key |
| `MSG91_TEMPLATE_ID` | MSG91 OTP Template ID |
| `OTP_MOCK` | Set `true` in local development to mock SMS sends |
| `VAPID_PUBLIC_KEY` | Web Push VAPID Public Key |
| `VAPID_PRIVATE_KEY` | Web Push VAPID Private Key |
| `CORS_ALLOWED_ORIGINS` | `https://cirota.in,https://admin.cirota.in,http://localhost:3000,http://localhost:5173` |
| `PORT` | HTTP Server port (default `3000`) |

---

## 5. Local Setup & Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Setup database and run migrations
npx prisma migrate dev --name init

# 3. Seed plans, 7-day menus, add-ons, and admin user
node prisma/seed.js

# 4. Run automated smoke tests
npm test

# 5. Start development server
npm run dev
```

---

## 6. Railway Production Deployment

1. **Provision PostgreSQL**:
   - In Railway, click **New Project** → **Provision PostgreSQL**.
   - Copy the provided `DATABASE_URL`.

2. **Deploy Node Service**:
   - In the same project, click **New** → **GitHub Repo** → select `cirota-backend`.
   - In **Variables**, add all variables from `.env.example`.

3. **Run Migrations & Seed on Railway**:
   - Connect via local terminal with Railway's `DATABASE_URL`:
     ```bash
     DATABASE_URL="<railway-postgres-url>" npx prisma migrate deploy
     DATABASE_URL="<railway-postgres-url>" node prisma/seed.js
     ```

4. **Configure Razorpay Webhook**:
   - In Razorpay Dashboard → **Settings** → **Webhooks** → **Add New Webhook**.
   - Webhook URL: `https://<your-railway-url>/api/payments/webhook`
   - Events: `payment.captured`, `payment.failed`, `order.paid`.
   - Copy the generated Webhook Secret into Railway environment variable `RAZORPAY_WEBHOOK_SECRET`.

5. **Share Google Sheets**:
   - Create Google Sheets for Master and Daily mirrors.
   - Click **Share** and add your Google service account email (`cirota-sync@...iam.gserviceaccount.com`) as **Editor**.
   - Set `MASTER_SHEET_ID` and `DAILY_SHEET_ID` in Railway.

---

## 7. API Reference

### Health Check
- `GET /health` — Verifies API uptime & PostgreSQL connectivity.

### Authentication (`/api/auth`)
- `POST /api/auth/otp/request` — Request 6-digit login OTP: `{ "phone": "9876543210" }`
- `POST /api/auth/otp/verify` — Verify OTP & receive JWT: `{ "phone": "9876543210", "otp": "123456" }`
- `POST /api/auth/admin/login` — Admin login: `{ "email": "admin@cirota.in", "password": "..." }`
- `POST /api/auth/delivery/login` — Delivery partner login: `{ "phone": "9876543210", "pin": "1234" }`

### Customer Endpoints (`/api/customer`)
- `GET /api/customer/me` — Profile, remaining tiffins, active plan, pause status.
- `POST /api/customer/subscribe` — New customer subscription.
- `POST /api/customer/pause/next-meal` — Pause next upcoming meal (does not decrement balance).
- `POST /api/customer/pause/indefinite` — Pause indefinitely.
- `POST /api/customer/resume` — Resume subscription.
- `POST /api/customer/plan/change` — Change plan with proration.
- `POST /api/customer/plan/cancel` — Cancel plan (preserves historical logs).
- `POST /api/customer/push/subscribe` — Register Web Push subscription.
- `GET /api/customer/orders/upcoming` — Next 14 days of scheduled meals.
- `GET /api/customer/orders/history` — Delivered order history with pagination.
- `PATCH /api/customer/orders/:id/modify` — Self-service edit of roti/paratha count on one of your own upcoming (undelivered) tiffins.

### Payments (`/api/payments`)
- `POST /api/payments/create-order` — Create Razorpay order for a selected plan.
- `POST /api/payments/webhook` — Signature-verified webhook handler with atomic balance reset.
- `GET /api/payments/history` — Customer payment records.

### Admin Endpoints (`/api/admin`)
- `GET /api/admin/customers` — Search & filter customers (area, status, dues).
- `GET /api/admin/customers/:id` — Single customer inspection.
- `PATCH /api/admin/customers/:id` — Manual balance, status, partner override.
- `GET /api/admin/daily-orders?date=YYYY-MM-DD` — Daily sheet entries.
- `PATCH /api/admin/daily-orders/:id` — Mark delivered, reassign partner, edit custom roti counts.
- `GET /api/admin/kitchen-summary?date=YYYY-MM-DD` — Packet prep count grouped by area & addons.
- `GET /api/admin/dues` — Outstanding payment dues list.
- `POST /api/admin/sync-sheets` — Manual Google Sheets sync trigger.
- `GET /api/admin/stats` — Dashboard metrics.
- `GET /api/admin/partners` — List delivery partners with customer/order counts.
- `POST /api/admin/partners` — Create a delivery partner (optional `pin`, defaults to `DELIVERY_DEFAULT_PIN`).
- `PATCH /api/admin/partners/:id` — Update name/area/active status.
- `PATCH /api/admin/partners/:id/pin` — Reset a delivery partner's login PIN.

### Delivery Partner Endpoints (`/api/delivery`) — all require a delivery-partner JWT
- `GET /api/delivery/me` — Partner profile + today's assigned/delivered/remaining counts.
- `GET /api/delivery/orders?date=YYYY-MM-DD&meal_type=lunch` — This partner's assigned tiffins for a day (defaults to today).
- `PATCH /api/delivery/orders/:id/delivered` — Mark (or unmark) one tiffin delivered. Ownership-checked; on mark-delivered it atomically decrements the customer's `tiffins_remaining`, same logic as the admin daily-sheet.
- `GET /api/delivery/summary?date=YYYY-MM-DD` — Packet counts by meal type for this partner's own route.

### Menu & Add-ons (`/api/menu`)
- `GET /api/menu/plans` — List all plans.
- `GET /api/menu/plans/:id` — Single plan with 7-day menu & meal components.
- `GET /api/menu/add-ons` — Add-ons catalogue.
