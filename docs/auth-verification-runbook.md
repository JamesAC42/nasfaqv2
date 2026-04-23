# Auth Verification Runbook

This app supports three account-protection pieces:

- Email verification before trading or user-generated content.
- Cloudflare Turnstile on login, registration, and Google sign-in.
- Google Sign-In as a login/registration option.

## Required URLs

Use the deployed frontend origin as the public app URL:

- Local: `http://localhost:3010`
- Production: `https://your-frontend-domain`

Set `PUBLIC_APP_BASE_URL` in `api/.env` to that value. Verification links use:

```text
${PUBLIC_APP_BASE_URL}/verify-email?token=...
```

## Email Verification

The API can send verification mail through Resend. If Resend variables are missing, the API logs the verification link instead, which is useful for local development.

1. Create or sign in to a Resend account.
2. Add and verify the sending domain you want to use.
3. Create an API key with email-send permission.
4. Set these API variables:

```text
RESEND_API_KEY=re_...
AUTH_EMAIL_FROM=NASFAQ <auth@your-domain.example>
PUBLIC_APP_BASE_URL=https://your-frontend-domain
EMAIL_VERIFICATION_PATH=/verify-email
EMAIL_VERIFICATION_TTL_HOURS=24
```

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

## Google Sign-In

1. Open Google Cloud Console.
2. Create or select a project.
3. Configure the OAuth consent screen.
4. Create an OAuth 2.0 Client ID with application type `Web application`.
5. Add authorized JavaScript origins:

```text
http://localhost:3010
https://your-frontend-domain
```

6. Copy the Client ID into both environments. The value ends with `.apps.googleusercontent.com`.

```text
# app-client/.env
NEXT_PUBLIC_GOOGLE_CLIENT_ID=...apps.googleusercontent.com

# api/.env
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
```

Do not put the OAuth client secret in the frontend. This implementation does not need the client secret in the API either; the API verifies Google ID tokens by checking that the token audience matches `GOOGLE_CLIENT_ID`.

Google accounts with verified emails are marked `email_verified=true` automatically. If a Google email matches an existing password account, the Google subject is linked to that user.

## Database Migration

Run the API once with migrations enabled, or apply the migration SQL through your normal deployment path:

```text
ENABLE_MIGRATIONS=true
```

The migration adds:

- `market.users.email`
- `market.users.email_verified`
- `market.users.email_verified_at`
- `market.users.google_sub`
- `market.user_email_verification_tokens`

After the migration is applied, return `ENABLE_MIGRATIONS` to your usual setting.
