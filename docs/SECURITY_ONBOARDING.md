# Security Onboarding

> This document covers secret management, environment separation, and production readiness checks. Read it before deploying or sharing the repository.

---

## 1. Secret Rotation Checklist

If `.env` has ever been shared, committed by mistake, or copied to an insecure location, **rotate these secrets immediately**:

| Secret                | How to Rotate                                         |
| --------------------- | ----------------------------------------------------- |
| `DATABASE_URL` (Neon) | Neon Console → Project → Roles → Reset password       |
| `DATABASE_URL_POOLER` | Same as above (uses same credentials)                 |
| `RESEND_API_KEY`      | Resend Dashboard → API Keys → Revoke + Create new     |
| `BETTER_AUTH_SECRET`  | Run `npx -y @better-auth/cli secret` → copy new value |

After rotating, update `.env.local` (never `.env` — see §3).

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

BullMQ queues and rate limiting silently skip if `REDIS_URL` is unset. In production, Redis is required — verify the connection at startup.

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
