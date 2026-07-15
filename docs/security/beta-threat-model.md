# Threat Model — Reputation Key Beta

**Date:** 2026-07-14
**Scope:** Internal-team beta with real Google Business Profile properties
**Method:** STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)

## Trust boundaries

1. **Public internet → Reverse proxy** — untrusted traffic; proxy terminates TLS, sets X-Forwarded-For
2. **Reverse proxy → Application (Nitro)** — trusted proxy count configurable via `TRUSTED_PROXY_COUNT`
3. **Application → PostgreSQL** — private network; credentials in env only
4. **Application → Redis (BullMQ + cache)** — private network; separate instances for queue vs cache
5. **Application → Google APIs** — OAuth tokens encrypted at rest (AES-256-GCM); scopes limited
6. **Application → Resend (email)** — API key in env; email capability off by default
7. **Application → AWS S3** — per-property object storage; upload capability off by default

## Assets

| Asset                      | Sensitivity                     | Location                                    |
| -------------------------- | ------------------------------- | ------------------------------------------- |
| User email, name           | PII                             | `user` table                                |
| Session tokens             | Secret                          | `session` table                             |
| OAuth tokens (Google)      | Secret (encrypted)              | `account`, `google_connections` tables      |
| Google refresh token       | Secret (encrypted)              | `google_connections` table                  |
| Review text, reviewer name | Google-sourced PII (30-day TTL) | `reviews` table                             |
| Reply text                 | User-authored content           | `replies` table                             |
| Guest IP hash              | Pseudonymous identifier         | `scan_events`, `ratings`, `feedback` tables |
| Audit log details          | Operational metadata            | `audit_logs` table                          |
| Notification body          | Content                         | `notifications` table                       |

## STRIDE analysis

### Spoofing

| Threat                                | Mitigation                                                                           | Status      |
| ------------------------------------- | ------------------------------------------------------------------------------------ | ----------- |
| Attacker registers without invitation | `identity.register` capability off by default; route checks `assertGlobalCapability` | ✅ Enforced |
| Attacker forges session token         | Better Auth session validation; httpOnly + secure cookies; no token in URLs          | ✅ Enforced |
| Attacker spoofs X-Forwarded-For       | `TRUSTED_PROXY_COUNT` limits trusted hops; client IP derived from correct position   | ✅ Enforced |
| Google webhook impersonation          | Pub/Sub JWT verification (`pubsub-jwt.verifier.ts`)                                  | ✅ Enforced |

### Tampering

| Threat                               | Mitigation                                                                             | Status                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| Attacker modifies another org's data | Organization + property scoping in every repository query; negative cross-tenant tests | ✅ Partial (tests pending full coverage) |
| Attacker bypasses authorization      | `AuthorizationPolicy.authorize()` required for mutations; role checks deprecated       | 🔄 Migration in progress                 |
| Replay of outbox events              | `event_consumer_receipts` for idempotency; lease-based claiming                        | ✅ Enforced                              |
| Review content modified after fetch  | `content_hash` column; source content TTL enforcement                                  | ✅ Enforced                              |

### Repudiation

| Threat                               | Mitigation                                                | Status             |
| ------------------------------------ | --------------------------------------------------------- | ------------------ |
| User denies performing action        | `audit_logs` with userId, ipAddress, action, resourceType | ✅ Enforced        |
| Operator denies capability change    | Capability decision log (identifiers + reason codes only) | 🔄 Logging pending |
| Reply publish denied/failed silently | Outbox events + BullMQ job status + audit log             | ✅ Enforced        |

### Information Disclosure

| Threat                         | Mitigation                                                                 | Status           |
| ------------------------------ | -------------------------------------------------------------------------- | ---------------- |
| Error responses leak internals | `redactError()` strips stack traces, DB details, PII; tagged errors only   | ✅ Enforced      |
| Logs contain secrets/PII       | Pino structured logging; redaction patterns for tokens, emails, cookies    | ✅ Module exists |
| Review text in outbox events   | Identifier-only payloads per ADR 0030; content stripped by adapter         | ✅ Enforced      |
| CSP bypass via injection       | Default-deny CSP; inline styles only (Vite requirement); no inline scripts | ✅ Enforced      |
| Guest IP exposed               | Hashed before storage (`ip_hash` column); raw IP never persisted           | ✅ Enforced      |
| Cross-tenant data in dashboard | Property-scoped queries; no org-level aggregation without authorization    | ✅ Enforced      |

### Denial of Service

| Threat                             | Mitigation                                              | Status                 |
| ---------------------------------- | ------------------------------------------------------- | ---------------------- |
| Burst of reviews overwhelms sync   | BullMQ bounded concurrency; outbox SKIP LOCKED claiming | ✅ Enforced            |
| Dashboard query timeout under load | Incremental rollup tables; dashboard cache with TTL     | ✅ Implemented         |
| GBP rate limit (429)               | Retry with backoff; sync paused on rate limit           | ✅ Enforced            |
| Large payload body                 | Body size limits at proxy layer                         | 🔄 Proxy config needed |

### Elevation of Privilege

| Threat                                   | Mitigation                                                                              | Status                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------ |
| Non-owner accesses admin functions       | Built-in role matrix; sensitive operations require owner role                           | ✅ Enforced              |
| Custom role grants unexpected permission | Custom roles disabled (`ENABLE_CUSTOM_ROLES` gate); `data_scope` limits property access | ✅ Enforced              |
| Last owner removed/demoted               | `member_last_owner_upd` trigger prevents removal                                        | ✅ Enforced              |
| Worker job runs for disabled capability  | Jobs re-check capability before side effects                                            | ✅ Enforced              |
| API route discovered despite UI disabled | Routes require capability; API routes check authorization                               | 🔄 Full coverage pending |

## Residual risks

1. **Full negative cross-tenant test coverage** — not every repository has negative tests yet; BETA-1 completes this.
2. **Body/time limits** — proxy-level request size limits not yet configured.
3. **Rate limiting on auth endpoints** — login/registration endpoints lack rate limiting; relies on proxy/network layer.
4. **Supply chain** — Dependabot configured but initial advisory scan returned 0 vulnerabilities; continuous monitoring needed.

## OWASP ASVS 5.0 mapping

| ASVS area             | Coverage                                                    |
| --------------------- | ----------------------------------------------------------- |
| V1 (Architecture)     | Bounded contexts, authorization policy, capability controls |
| V2 (Authentication)   | Better Auth, email verification, session management         |
| V3 (Session)          | httpOnly/secure cookies, session expiry, cookie cache       |
| V4 (Access Control)   | AuthorizationPolicy, property scoping, negative tests       |
| V5 (Validation)       | Zod env validation, input validation at API boundaries      |
| V7 (Logging)          | Structured logging, redaction patterns, audit trail         |
| V8 (Data Protection)  | Encryption at rest (OAuth tokens), TTL on review content    |
| V9 (Communications)   | TLS via proxy, CSP, HSTS                                    |
| V12 (Files/Resources) | Upload capability disabled; S3 private objects when enabled |
| V14 (Configuration)   | Env validation, least-privilege CI, CODEOWNERS              |
