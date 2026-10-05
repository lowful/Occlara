# Occlara Backend Server

Express API server handling Stripe payments, license key generation and validation,
Stripe webhook processing, and the AI coaching routes the desktop client calls.

Accounts and sessions live in Supabase and are handled by the website, not here.
This server talks to Supabase with the service role key.

## Setup

### 1. Install dependencies

```bash
cd server
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in all values:

- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, required. Every license lookup goes
  through Supabase, so without these the server boots and then fails every request.
- `STRIPE_SECRET_KEY`, from the Stripe dashboard (test key starts with `sk_test_`)
- `STRIPE_WEBHOOK_SECRET`, generated when you configure the webhook endpoint
- `STRIPE_PRICE_WEEKLY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_LIFETIME`, price IDs from Stripe
- `ADMIN_PASSWORD`, gates `/api/admin/*`. Unset means those routes always answer 401.
- `AI_API_KEY`, `AI_BASE_URL`, the OpenAI-compatible provider used for coaching

### 3. Create Stripe products and prices

Create the following in the [Stripe dashboard](https://dashboard.stripe.com/products) or via the Stripe CLI:

| Plan     | Amount  | Type        | Price ID env var         |
|----------|---------|-------------|--------------------------|
| Weekly   | $4.99   | Recurring (weekly)   | `STRIPE_PRICE_WEEKLY`   |
| Monthly  | $14.99  | Recurring (monthly)  | `STRIPE_PRICE_MONTHLY`  |
| Lifetime | $59.99  | One-time payment     | `STRIPE_PRICE_LIFETIME` |

**Via Stripe CLI:**

```bash
# Weekly subscription
stripe prices create \
  --unit-amount 499 \
  --currency usd \
  --recurring[interval]=week \
  --product-data[name]="Occlara Weekly"

# Monthly subscription
stripe prices create \
  --unit-amount 1499 \
  --currency usd \
  --recurring[interval]=month \
  --product-data[name]="Occlara Monthly"

# Lifetime one-time payment
stripe prices create \
  --unit-amount 5999 \
  --currency usd \
  --product-data[name]="Occlara Lifetime"
```

Copy the returned `price_xxx` IDs into your `.env` file.

### 4. Start the server

```bash
# Production
npm start

# Development (auto-reload)
npm run dev
```

Server runs on port `3000` by default (configurable via `PORT` in `.env`).

### 5. Configure Stripe webhooks

**For local development**, use the Stripe CLI to forward events:

```bash
stripe listen --forward-to localhost:3000/api/payments/webhook
```

Copy the webhook signing secret it prints (`whsec_...`) into `STRIPE_WEBHOOK_SECRET` in your `.env`.

**For production**, create a webhook endpoint in the Stripe dashboard pointing to:

```
https://your-server.com/api/payments/webhook
```

Subscribe to these events:
- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.deleted`
- `charge.refunded`
- `charge.dispute.created`

The last two revoke a refunded or disputed licence. The handler cannot run on an
event Stripe never sends, so the endpoint must list them.

## API Endpoints

The `Gate` column is what the server actually enforces today, not what it ought to.

`session` means `Authorization: Bearer <Supabase access token>`. The route acts on
the user Supabase says the token belongs to; a `userId` sent as well must be that
same user or the request is refused (403). See `services/account-auth.js`.

### Payments

| Method | Path                            | Gate | Description                        |
|--------|---------------------------------|------|------------------------------------|
| POST   | `/api/payments/create-checkout` | none | Create Stripe Checkout session URL |
| POST   | `/api/payments/cancel`          | session | Cancel the signed in user's subscription |
| GET    | `/api/payments/success`         | none | Poll for license after payment     |
| POST   | `/api/payments/webhook`         | Stripe signature | Stripe webhook receiver |

### License

| Method | Path                      | Gate | Description                            |
|--------|---------------------------|------|----------------------------------------|
| POST   | `/api/license/activate`   | none, rate limited | Bind a key to a device   |
| POST   | `/api/license/deactivate` | session | Unbind the signed in user's device |
| POST   | `/api/license/validate`   | none | Validate a key, used by the client     |

A licence lookup that fails for a database or network reason is answered 503
with `retry: true` and no `valid` field, never as "not found". Only a missing row
is a 404.

### Account

| Method | Path                     | Gate | Description                              |
|--------|--------------------------|------|------------------------------------------|
| GET    | `/api/account/dashboard` | session | License and billing summary for the signed in user |
| POST   | `/api/account/portal`    | session | Stripe billing portal URL for the signed in user |

### Coach

Every `/api/coach/*` route requires an `X-License-Key` header holding an active,
unexpired key, and is rate limited. Routes cover `analyze`, `chat`, `frame-chat`,
`recap`, round and match summaries, session scoring, match and rank lookups,
`detect-agent`, and `match-review`. See `routes/coach.js`. A key that cannot be
checked because the database is failing is answered 503 with `retry: true`, not
403, and a key confirmed in the last half hour is still honoured through it.

### Admin

| Method | Path                   | Gate                     | Description              |
|--------|------------------------|--------------------------|--------------------------|
| GET    | `/api/admin/coaching`  | `x-admin-password` header | Aggregate tip/reject counts |
| GET    | `/api/admin/costs`     | `x-admin-password` header | AI call and cost totals  |
| GET    | `/api/admin/live`      | `x-admin-password` header | Who is using it right now |

The header only, never a query string, compared in constant time. Ten failed
attempts an hour per IP, across `/api/admin` and `/admin`, then 429. The same
password is what lets a bench run `benchModel` (see `benchModel` in coach.js).

### Health

| Method | Path          | Description                                  |
|--------|---------------|----------------------------------------------|
| GET    | `/health`     | Status plus the live AI model slugs           |
| GET    | `/api/health` | Same payload, for platforms that require /api |

## Database

Supabase (Postgres) is the only datastore. The server uses the service role key,
which bypasses row level security, so authorization has to be enforced here in
the route handlers.

Tables:
- `licenses`, license key, plan, status, expiry, bound device, deactivation quota,
  linked Stripe customer/subscription, and the owning Supabase `user_id`

## Authorization, still to do

Because the service role key bypasses row level security, these handlers are the
only place authorization can happen.

The account routes (`cancel`, `deactivate`, `dashboard`, `portal`) now verify a
Supabase session.

**Deploy order.** These four answer 401 to a request that carries no
`Authorization: Bearer <access token>`, so the website (and anything else that
calls them, such as a Lovable server function) must send the signed in user's
access token BEFORE this server is deployed, or the account page stops working
for everyone at once. The token is `session.access_token` from the site's
Supabase client. Nothing in this repo can check what the site sends.

`/api/payments/cancel` answers 400 with the reason in `error` when the account
has nothing that can charge again (lifetime, or no live subscription), the same
shape lifetime always got, and writes nothing.

Two pieces are still open:

- `/api/payments/create-checkout` still takes `userId` and `email` from the body.
  The worst a caller can do with it is pay for a licence on someone else's
  account, but it should take the session too once the site sends one there.
- `/api/coach/*` checks that the license key is active but not that it is being
  used from the device it was activated on, so the one device per key rule that
  `/api/license/activate` enforces does not hold on the paid routes.

Any new route that acts on an account uses `requireUser` from
`services/account-auth.js`, never a `userId` the caller names.

## License Key Format

`GC-XXXX-XXXX-XXXX-XXXX` (uppercase alphanumeric segments)

## Notes

- The webhook route (`/api/payments/webhook`) is registered **before** the global JSON body parser so Stripe signature verification works correctly (requires raw body).
- License keys are generated automatically when `checkout.session.completed` fires.
- Subscription renewals are handled via `invoice.paid` events, which extend the `expires_at` date.
- TODO: Integrate an email provider (Resend, SendGrid) to email license keys to users on purchase.
