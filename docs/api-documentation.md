# ShieldCaptcha API Documentation (v1)

## Overview

ShieldCaptcha provides an international, privacy-first CAPTCHA-as-a-Service REST API.
Challenge generation and server-side verification are strictly decoupled. Private Secret Keys are never shared with client browsers.

Base URL: `https://your-domain.com/api/v1`

---

## 1. System Health Check

### `GET /api/v1/health`

Returns server health, active storage engine (PostgreSQL or persistent file storage), and Firebase Admin status.

**Response (200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2026-10-19T10:20:00.000Z",
  "version": "1.0.0-mvp",
  "database": {
    "isPostgresConnected": false,
    "engine": "file_persisted_storage",
    "databaseUrlConfigured": false
  },
  "firebaseAuth": {
    "isInitialized": false,
    "authMode": "development_session_jwt"
  },
  "serverMode": "development"
}
```

---

## 2. Issue Visual Challenge

### `POST /api/v1/captcha/challenge`

Generates a randomized visual challenge for the specified Site Key and domain.

**Request Body:**
```json
{
  "siteKey": "sc_site_98a76b5c4d3e2f1a0b9c8d7e",
  "domain": "example.com"
}
```

**Response (200 OK):**
```json
{
  "challengeId": "ch_7a8b9c0d1e2f3a4b",
  "siteKey": "sc_site_98a76b5c4d3e2f1a0b9c8d7e",
  "prompt": "تصویر «سپر امنیت (Shield) / Shield» را انتخاب کنید.",
  "options": [
    { "id": "opt_a1b2c3d4", "svg": "data:image/svg+xml;utf8,..." },
    { "id": "opt_e5f6g7h8", "svg": "data:image/svg+xml;utf8,..." },
    { "id": "opt_i9j0k1l2", "svg": "data:image/svg+xml;utf8,..." },
    { "id": "opt_m3n4o5p6", "svg": "data:image/svg+xml;utf8,..." }
  ],
  "token": "sct_XYZ1234567890abcdef...",
  "expiresInSeconds": 20,
  "expiresAt": "2026-10-19T10:20:20.000Z"
}
```

*Note: The response never reveals the correct answer. Option IDs are randomized opaque hashes.*

---

## 3. Server-Side Verification

### `POST /api/v1/captcha/verify`

Called by your backend server to verify the user-submitted CAPTCHA token.

**Request Body:**
```json
{
  "secretKey": "sc_sec_live_abcdef123456...",
  "token": "sct_XYZ1234567890abcdef...",
  "remoteIp": "203.0.113.195",
  "hostname": "example.com",
  "action": "login"
}
```

**Response (200 OK - Success):**
```json
{
  "success": true,
  "score": 82,
  "hostname": "example.com",
  "challenge_ts": "2026-10-19T10:21:15.000Z",
  "action": "login",
  "development_mode": true,
  "error_codes": [],
  "risk_action": "challenge",
  "risk_signals": ["quick-solve"]
}
```

**Response (200 OK - Replay / Expired Failure):**
```json
{
  "success": false,
  "score": 0,
  "hostname": "example.com",
  "challenge_ts": "2026-10-19T10:21:15.000Z",
  "action": "login",
  "development_mode": true,
  "error_codes": ["timeout-or-duplicate"]
}
```

### Error Codes:
- `missing-input-response`: The `token` parameter was missing.
- `invalid-input-response`: The `token` parameter is malformed or invalid.
- `timeout-or-duplicate`: The token was already consumed or has timed out (Replay Protection).
- `challenge-expired`: The challenge TTL (20s) has expired.
- `max-attempts-exceeded`: Too many incorrect solution attempts were submitted.
- `incorrect-captcha-sol`: The visual item selected does not match the prompt.
- `invalid-secret-key`: The provided Secret Key does not match the site.
- `domain-mismatch`: The origin or domain is not authorized in site settings.


## Adaptive anti-bot risk fields

Every verification response includes a server-computed `score` from 0 (highest risk) to 100 (lowest observed risk). It is based on solve duration, incorrect attempts, automation-like user-agent indicators, request headers, and recent verification volume/failures from the same IP. The response can also include:

- `risk_action`: `allow`, `challenge`, or `block`.
- `risk_signals`: short reason codes explaining which signals affected the score.

The score is a deterministic rules-based risk estimate, not a trained machine-learning probability. Do not trust a score supplied by the browser. For ordinary sensitive actions, apply a server-side policy such as requiring `success === true` and `score >= 70`; consider a higher threshold and additional controls for payments, account recovery, and administrator actions. Tune thresholds against your own false-positive and abuse data.
