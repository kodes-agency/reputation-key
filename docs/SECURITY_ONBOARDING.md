# Security Onboarding

> This document covers secret management, environment separation, and production readiness checks. Read it before deploying or sharing the repository.

---

## 1. Secret Rotation Checklist

If `.env` has ever been shared, committed by mistake, or copied to an insecure location, **rotate these secrets immediately**:

| Secret                               | How to Rotate                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL` (Railway PostgreSQL)  | Rotate the scoped database role/password in the `cell-us` Railway database and update every approved service reference   |
| `DATABASE_URL_POOLER`                | Rotate with the same scoped database authority; verify direct and pooled references before retiring the prior credential |
| `RESEND_API_KEY`                     | Resend Dashboard → API Keys → Revoke + Create new                                                                        |
| `BETTER_AUTH_SECRET`                 | Run `openssl rand -base64 48` and install the new value                                                                  |
| `NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS` | Add a new active `vN:<64-hex>` from `openssl rand -hex 32`; retain the prior version for 90 days                         |

After rotating, update `.env.local` (never `.env` — see §3).

For `NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS`, install the new keyring on the web and
worker services in the same Data Cell as one release. Keep the immediately
previous version for at least the 90-day notification evidence window; an open
digest also pins its signing version so provider retries remain byte-for-byte
stable during rotation. Do not remove a retained version while any open digest
uses it.

Migration `0104_notification_one_click_unsubscribe` deliberately leaves a
`legacy` database default for rolling-deploy compatibility. A later contract
migration may remove that default only after every web/worker instance runs the
new writer and this query returns zero:

```sql
SELECT count(*)
FROM notification_digest_batches
WHERE state IN ('prepared', 'retryable')
  AND unsubscribe_key_version = 'legacy';
```

---

## 2. Environment Configuration

Use separate env files per environment:

```
.env.development    # Local dev defaults
.env.test           # Test runner overrides
.env.production     # Production values (never committed)
.env.local          # Your personal overrides (gitignored)
```

The app loads `.env.local` last and overrides everything else. Keep `.env` as a template reference only.

### Quick setup for new developers

```bash
cp .env.example .env.local
# Edit .env.local with your values
pnpm dev
```

---

## 3. Git Safety

`.gitignore` already excludes `.env`, `.env.local`, `.env.*`. If you ever see `.env` in `git status`:

```bash
git rm --cached .env        # Unstage if accidentally added
git commit -m "Remove .env"
```

Then rotate all secrets (§1) — once pushed to a remote, consider them compromised.

---

## 4. Production Blockers

These are **acceptable for local development** but must be resolved before going live:

### 4.1 Email verification is environment-driven

`EMAIL_VERIFICATION_REQUIRED` (`src/shared/config/env.ts`) defaults to `true` in
production and `false` in development and test; there is no code toggle to flip.
Public registration is refused at the HTTP boundary
(`src/routes/api/auth/$.ts`) and by the compile-time-blocked
`identity.register` capability.

### 4.2 HTTPS cookie enforcement

Cookies are `Secure` whenever `BETTER_AUTH_URL` is HTTPS
(`src/shared/auth/auth.ts`). Deployed production requires an HTTPS public origin;
only loopback production rehearsals have a documented HTTP exception.

### 4.3 Redis is optional in dev

Local development may use one `REDIS_URL` for cache/rate limiting and BullMQ.
Production web and worker require a physically distinct `QUEUE_REDIS_URL` and
refuse boot when either resource is absent or both URLs resolve to one host.
They inspect the live queue runtime before creating BullMQ clients: Redis 6.2+,
GETDEL, and `maxmemory-policy=noeviction` are mandatory. Producer queue calls
have a bounded timeout/retry policy; Worker blocking connections reconnect
until the process enters its bounded shutdown drain.

---

## 5. CI / CD Security

- Store production secrets in your hosting provider's secret manager (Railway variables, GitHub Actions secrets, etc.)
- Never echo secrets in CI logs
- Run `pnpm typecheck && pnpm lint && pnpm test` in CI before every deploy

---

## 6. Incident Response

If secrets are leaked:

1. **Rotate immediately** (§1)
2. **Check the `cell-us` Railway PostgreSQL service logs and RepKey policy/action audit records** for unauthorized access
3. **Check Resend logs** for unauthorized email sends
4. **Invalidate Better Auth sessions** by rotating `BETTER_AUTH_SECRET` (forces all users to re-authenticate)
