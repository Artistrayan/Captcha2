# ShieldCaptcha marketing site

A bilingual (English/Persian) static marketing landing page for ShieldCaptcha. It is intentionally separate from the authenticated dashboard source and does not claim that the MVP is a complete production bot-detection engine.

## Deploy free with Cloudflare Pages

1. Sign in at https://dash.cloudflare.com/ and open **Workers & Pages**.
2. Choose **Create application → Pages → Connect to Git**.
3. Select the GitHub repository `Artistrayan/Captcha2` and branch `main`.
4. Set **Root directory (advanced)** to `landing`.
5. Leave the build command empty (or use no build command) and set the output directory to `.` if the UI requires one.
6. Deploy. Cloudflare will assign a free `*.pages.dev` address if the chosen project name is available.
7. Future commits to `landing/` on the connected branch can trigger automatic deployments.

## Current links

- Dashboard: https://shieldcaptcha-web.onrender.com
- Landing page source: https://github.com/Artistrayan/Captcha2/tree/main/landing

## Notes

- The page is static and does not require API keys.
- The demo panel graphic is illustrative only; it does not run a CAPTCHA challenge.
- A free `pages.dev` subdomain is not a custom domain and is not automatically an authorized sender domain for email. For a branded sender such as `no-reply@yourdomain.com`, verify a domain with the email provider and configure DNS records.
- If the GitHub repository is private, grant Cloudflare Pages access to it during Git connection.
