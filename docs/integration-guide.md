# ShieldCaptcha Integration Guide

This guide walks you through integrating the ShieldCaptcha widget into your web frontend and verifying challenges on your backend.

---

## Architecture Flow

1. **Frontend**: Requests a visual challenge from ShieldCaptcha API using your public `siteKey`.
2. **User**: Selects the matching visual image item.
3. **Frontend**: Receives a single-use `token` upon successful puzzle resolution.
4. **Form Submission**: Submits the `token` along with login/checkout form data to your server.
5. **Backend**: Calls `POST /api/v1/captcha/verify` using your private `secretKey` and the client's `token`.
6. **Decision**: Require `success: true` and apply your server-side risk threshold before processing sensitive requests.

---

## 1. Frontend Integration (React)

Install the widget or copy `CaptchaWidget.tsx`:

```tsx
import React, { useState } from 'react';
import { CaptchaWidget } from './components/CaptchaWidget';

export function CheckoutForm() {
  const [captchaToken, setCaptchaToken] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captchaToken) {
      alert('Please complete the CAPTCHA first');
      return;
    }

    const response = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 49.00,
        captchaToken,
      }),
    });

    const result = await response.json();
    console.log(result);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Your form fields */}
      <CaptchaWidget
        siteKey="sc_site_YOUR_PUBLIC_KEY"
        theme="dark"
        onVerify={(token) => setCaptchaToken(token)}
        onError={(err) => console.error('Captcha error:', err)}
      />

      <button type="submit" disabled={!captchaToken}>
        Complete Checkout
      </button>
    </form>
  );
}
```

---

## 2. Backend Verification (Node.js / Express)

In your server route handler, verify the token before performing sensitive actions:

```typescript
import express from 'express';

const app = express();
app.use(express.json());

const SHIELDCAPTCHA_SECRET_KEY = process.env.SHIELDCAPTCHA_SECRET_KEY; // sc_sec_live_...

app.post('/api/checkout', async (req, res) => {
  const { amount, captchaToken } = req.body;

  // 1. Verify CAPTCHA token with ShieldCaptcha server
  const verifyResponse = await fetch('http://localhost:3000/api/v1/captcha/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secretKey: SHIELDCAPTCHA_SECRET_KEY,
      token: captchaToken,
      remoteIp: req.ip,
      action: 'checkout',
    }),
  });

  const verification = await verifyResponse.json();

  // CAPTCHA validity and bot-risk policy are separate checks. Tune the threshold for your use case.
  if (!verification.success || verification.score < 70 || verification.risk_action === 'block') {
    return res.status(403).json({
      error: 'Bot verification failed',
      details: verification.error_codes,
    });
  }

  // 2. Token is valid and has been atomically consumed
  // Continue checkout logic...
  res.json({ success: true, message: 'Order processed successfully' });
});
```

---

## Security Best Practices

1. **Keep Secret Keys Private**: Never place your `secretKey` in frontend code, client bundles, or mobile applications.
2. **Always Verify Server-Side**: Client-side verification alone cannot protect against bots and automated scripts.
3. **Handle Replays Gracefully**: Each token is single-use and valid for 20 seconds. If a user submits a form multiple times, require a new challenge.


## Adaptive risk policy

The verification API computes risk on the server and may return `risk_action` (`allow`, `challenge`, or `block`) and `risk_signals`. A valid visual answer does not mean every action is safe: check the returned score server-side. A starting threshold of 70 is reasonable for ordinary form submissions; use stronger checks for payments, sign-in abuse, password reset, and privileged operations. Do not use the score as the only security control.

The current engine is an explainable rules-based detector, not a trained ML model. A trained model must only be enabled after collecting appropriately protected, labelled traffic and validating false-positive rates.
