# ShieldCaptcha

Privacy-focused CAPTCHA-as-a-Service MVP built with React, TypeScript, Vite, Express, PostgreSQL, Drizzle ORM, and Firebase Admin Authentication.

> **MVP limitation:** the current challenge engine uses locally generated SVG visual puzzles. It is not an advanced ML-based bot-detection or behavioral-risk engine and must not be marketed as guaranteeing bot prevention.

## Current capabilities

- Website/site-key management with a one-time display of the secret key.
- Hostname allow-list validation when issuing challenges.
- Three SVG challenge patterns: category selection, odd-one-out, and upright/rotation matching, with randomized opaque option IDs.
- Four incorrect answers allowed per challenge; a fifth request is rejected.
- 20-second solve deadline.
- Server-only HMAC answer validation, atomic challenge consumption, and replay protection.
- Separate one-time server-to-server receipt verification using the site's secret key.
- PostgreSQL persistence with Drizzle migrations; local file storage is for non-production development only.
- Server-side Firebase ID-token verification and Firebase email/password dashboard sign-in.
- Server-side 24-hour analytics aggregates and UTC-aligned hourly chart buckets.
- Request rate limits configurable through environment variables.

## Requirements

- Node.js 22+
- Bun (used by CI and the lockfile)
- PostgreSQL for persistent/production use
- A Firebase project with Email/Password sign-in enabled for dashboard authentication

## Local development

1. Install dependencies:

   ```sh
   bun install --frozen-lockfile
   ```

2. Copy `.env.example` to `.env` and set local values. Leave `DATABASE_URL` unset to use the local development file store, or point it at a local PostgreSQL instance.

3. Start the development server:

   ```sh
   bun run dev
   ```

4. Run validation:

   ```sh
   bun run lint
   bun run test -- --no-file-parallelism
   bun run build
   ```

The local file store is written to `.data/shieldcaptcha_db.json` and must not be committed. Production explicitly refuses this fallback.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Set to `production` for deployment. |
| `PORT` | HTTP server port; defaults to the configured app port. |
| `DATABASE_URL` | PostgreSQL connection string; required in production. |
| `CAPTCHA_SERVER_SALT` | Private server-only HMAC salt; required in production. |
| `SESSION_JWT_SECRET` | Strong server-side session secret; required in production. |
| `FIREBASE_PROJECT_ID` | Firebase project used by Firebase Admin. |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | JSON service-account credential; required for production Firebase Admin verification on Render. Keep it server-side only. |
| `VITE_FIREBASE_API_KEY` | Public Firebase Web API key used by the browser sign-in form. This is not a service-account credential. |
| `APP_URL` | Optional canonical app URL for self-testing/domain configuration. |
| `RATE_LIMIT_CHALLENGES_PER_MIN` | Challenge issuance limit per client IP; default 20. |
| `RATE_LIMIT_VERIFY_PER_MIN` | Verification endpoint limit per client IP; default 30. |

Never commit real credentials, database URLs, or secret keys. The `VITE_` variable is embedded in the browser build, so it must only contain the public Firebase Web API key.

## Database migrations

The server applies Drizzle migrations when PostgreSQL connects. CI also applies the migrations against a temporary PostgreSQL service.

To apply migrations manually:

```sh
DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DB' bun run db:migrate
```

## CAPTCHA integration flow

### 1. Issue a challenge

Browser/widget request:

```http
POST /api/v1/captcha/challenge
Content-Type: application/json

{ "siteKey": "sc_site_...", "lang": "en" }
```

The server derives the browser hostname from `Origin` or `Referer` in production and checks it against the site's configured domains. The challenge response includes a short-lived token and opaque option IDs; the correct option and answer hash are never returned.

### 2. Solve the challenge in the browser

The widget submits the selected opaque option ID:

```http
POST /api/v1/captcha/verify
Content-Type: application/json

{ "token": "sct_...", "selectedOptionId": "opt_..." }
```

A successful solve consumes the challenge and records its successful solve timestamp. The browser's response is not a substitute for the customer's own backend verification.

### 3. Verify the receipt on the customer's backend

After receiving the token from the browser, the customer's server sends:

```http
POST /api/v1/captcha/verify
Content-Type: application/json

{ "secretKey": "sc_sec_live_...", "token": "sct_..." }
```

Keep `secretKey` on the customer's server only. A valid receipt must have been solved, is accepted for up to two minutes after solving, and can be verified server-side only once. A missing, incorrect, expired, or replayed receipt fails closed.

The deployed endpoint URL should be taken from the active deployment configuration. The Render URL currently referenced by the dashboard is `https://shieldcaptcha-web.onrender.com`.

## API endpoints

- `GET /api/v1/health` — service/dependency status; returns 503 in production when PostgreSQL or Firebase Admin is unavailable.
- `POST /api/v1/auth/session` — development-only session creation; disabled in production.
- `GET /api/v1/auth/me` — current authenticated user.
- `GET /api/v1/sites`, `POST /api/v1/sites`, `DELETE /api/v1/sites/:id` — authenticated site management.
- `POST /api/v1/captcha/challenge` — issue a challenge.
- `POST /api/v1/captcha/verify` — public solve or private server-side receipt verification, selected by whether `secretKey` is supplied.
- `GET /api/v1/analytics/usage` — authenticated 24-hour aggregate analytics for the current user's sites.

## Deployment

The repository includes `render.yaml` for a Render web service and PostgreSQL database. Before production deployment, configure the Render environment variables for the Firebase Web API key, Firebase project ID, valid Firebase service-account JSON, and the generated server secrets. Then verify `GET /api/v1/health` reports `healthy` and test the complete browser-solve plus server-receipt flow against the deployed service.

A green CI run verifies type-checking, automated tests, PostgreSQL migrations, and the production build; it does not by itself prove that production environment variables or a live deployment are configured correctly.
