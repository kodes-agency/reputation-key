# Security Onboarding

> This document covers secret management, environment separation, and production readiness checks. Read it before deploying or sharing the repository.

---

## 1. Secret Rotation Checklist

If `.env` has ever been shared, committed by mistake, or copied to an insecure location, **rotate these secrets immediately**:

| Secret                               | How to Rotate                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL` (Neon)                | Neon Console → Project → Roles → Reset password                                                  |
| `DATABASE_URL_POOLER`                | Same as above (uses same credentials)                                                            |
| `RESEND_API_KEY`                     | Resend Dashboard → API Keys → Revoke + Create new                                                |
| `BETTER_AUTH_SECRET`                 | Run `openssl rand -base64 48` and install the new value                                          |
| `NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS` | Add a new active `vN:<64-hex>` from `openssl rand -hex 32`; retain the prior version for 90 days |

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

### 4.1 Email verification is disabled

`src/shared/auth/auth.ts`:

```ts
emailAndPassword: {
  requireEmailVerification: false,   // ← MUST be true in production
}
```

**Why it matters:** Anyone can register with any email address. Password resets can be triggered for unverified addresses.

**Prerequisites to enable:**

1. Verify Resend domain ownership (not sandbox)
2. Test `sendVerificationEmail` flow end-to-end
3. Update login/register UX to show "check your email" state
4. Add unverified-user reminder UI

### 4.2 No HTTPS enforcement

Better Auth cookies should set `secure: true` in production. Verify in `auth.ts`.

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
2. **Check Neon logs** for unauthorized queries
3. **Check Resend logs** for unauthorized email sends
4. **Invalidate Better Auth sessions** by rotating `BETTER_AUTH_SECRET` (forces all users to re-authenticate)

## 7. Email Verification

Email verification is currently disabled (`requireEmailVerification: false`). To enable:

1. Verify Resend domain ownership
2. Run `scripts/migrations/verify-existing-emails.sql` against the database
3. Test full signup → verify → sign-in flow
4. Set `requireEmailVerification: true` in `src/shared/auth/auth.ts`
5. Uncomment the `emailVerification` block in `createAuth()`
