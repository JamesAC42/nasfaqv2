# Auth Verification Runbook

Accounts are a username, an email and a password. Three pieces protect them:

- Email verification before trading or user-generated content.
- Password reset by email ("Forgot it?" on the sign-in page).
- Cloudflare Turnstile on sign-in, sign-up and forgot-password.

## Required URLs

Use the deployed frontend origin as the public app URL:

- Local: `http://localhost:3010`
- Production: `https://holo.nasfaq.biz`

Set `PUBLIC_APP_BASE_URL` in `api/.env` to that value. Email links use:

```text
${PUBLIC_APP_BASE_URL}/verify-email?token=...
${PUBLIC_APP_BASE_URL}/reset-password?token=...
```

The site doesn't load its analytics script on those two pages, so the tokens stay out of it.

## Email (Resend)

The API sends account email through Resend (`api/src/services/email.js`). If Resend variables are missing, the API logs the link instead, which is useful for local development.

1. Create or sign in to a Resend account.
2. Add the sending domain (the part after `@` in `AUTH_EMAIL_FROM`, e.g. `auth.nasfaq.biz`) under Domains, add the DNS records Resend lists (DKIM `resend._domainkey…`, and the `send…` MX and SPF TXT), and wait for it to show Verified. Until then Resend rejects every send. nasfaq.biz's DNS is served by Cloudflare (its nameservers), so the records go in Cloudflare → nasfaq.biz → DNS, not DigitalOcean.
3. Create an API key with email-send permission.
4. Set these API variables:

```text
RESEND_API_KEY=re_...
AUTH_EMAIL_FROM=NASFAQ <noreply@auth.nasfaq.biz>
PUBLIC_APP_BASE_URL=https://holo.nasfaq.biz
EMAIL_VERIFICATION_PATH=/verify-email
EMAIL_VERIFICATION_TTL_HOURS=24
```

A failed send is logged by the API as `email "<subject>" failed: Resend <status> <message>`. To check the whole path in production, use "Forgot it?" on your own account and confirm the email arrives.

## Password reset

- `POST /api/auth/forgot-password` `{ login, turnstile_token }`: `login` is a username or email. It always answers `{ ok: true }` (so it can't be used to find accounts), then emails the account's address a link. Rate limits: 10 an hour per IP, 3 an hour per `login`, and one link a minute per account.
- `POST /api/auth/reset-password` `{ token, password }`: a link works once, for an hour, and only while the account still has the address it was sent to. It sets the password, spends the account's other reset links, signs out every session, marks the email verified (the link proved it), and signs this browser in.
- Tokens are stored only as SHA-256 hashes in `market.user_password_reset_tokens`.

## Cloudflare Turnstile

Turnstile is currently used only on auth forms. It is intentionally not attached to comment/article/trade forms because Turnstile can still surface an interactive challenge; verified email plus session auth gates those actions instead.

1. Open Cloudflare Dashboard.
2. Go to `Turnstile`.
3. Create a widget for the frontend domain.
4. Add local development hostnames if needed, such as `localhost`.
5. Copy the site key into `app-client/.env`.
6. Copy the secret key into `api/.env`.

```text
# app-client/.env
NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x...

# api/.env
TURNSTILE_SECRET_KEY=0x...
```

If `TURNSTILE_SECRET_KEY` is empty, the API skips Turnstile verification.

## Database Migration

The API's migrations create what these need (the release's migrate job runs them):

- `market.users.email`, `email_verified`, `email_verified_at`
- `market.user_email_verification_tokens`
- `market.user_password_reset_tokens`
