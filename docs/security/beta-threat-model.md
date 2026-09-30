# Threat Model — Reputation Key Beta

**Date:** 2026-09-03
**Scope:** Invitation-only external closed beta (cohort railway-closed-beta-1) with real Google Business Profile properties and publicly reachable guest Portals
**Method:** STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)
**Accountable owner:** Bozhidar Denev

## Trust boundaries

1. **Public internet → Reverse proxy** — untrusted traffic; proxy terminates TLS, sets X-Forwarded-For
2. **Railway edge → Application (Nitro)** — `TRUSTED_PROXY_MODE=railway-edge` consumes the platform `X-Real-IP` contract; generic XFF is separately opt-in and bounded
3. **Application → PostgreSQL** — private network; credentials in env only
4. **Application → Redis (BullMQ + cache)** — private network; separate instances for queue vs cache
5. **Application → Google APIs** — credential-bearing routes use the authorized mTLS gateway and one-use database permit; OAuth tokens are encrypted at rest (AES-256-GCM) and scopes are limited. Fixed-origin, non-credential JWKS retrieval is the sole direct trust-read exception.
6. **Application → Resend (email)** — API key in env; email capability off by default
7. **Application → private Railway bucket (`sjc`)** — per-property object
   storage through Railway's S3-compatible API; no public bucket authority
8. **Application → Sentry (US region)** — mandatory production error monitoring and
   manager-authored beta feedback; outbound payload allowlisted and scrubbed

## Assets

| Asset                          | Sensitivity                                                                    | Location                                     |
| ------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------- |
| User email, name               | PII                                                                            | `user` table                                 |
| Session tokens                 | Secret                                                                         | `session` table                              |
| OAuth tokens (Google)          | Secret (encrypted)                                                             | `account`, `google_connections` tables       |
| Google refresh token           | Secret (encrypted)                                                             | `google_connections` table                   |
| Review text, reviewer name     | Google-sourced PII (30-day TTL)                                                | `reviews` table                              |
| Reply text                     | User-authored content                                                          | `replies` table                              |
| Guest network pressure         | Short-lived Portal-scoped pseudonym                                            | `guest_network_pressure_records` table       |
| Audit log details              | Operational metadata                                                           | `audit_logs` table                           |
| Notification body              | Content                                                                        | `notifications` table                        |
| Beta feedback text             | User-authored restricted content                                               | US-region Sentry project                     |
| Optional masked Bug layout     | Content-free visual geometry                                                   | Restricted Sentry attachment, ≤30-day clock  |
| Beta feedback correlation      | Pseudonymous identifier                                                        | HMAC-only Sentry tags / Redis abuse budgets  |
| Beta feedback triage           | Content-free support evidence                                                  | PostgreSQL receipt + append-only transitions |
| Cross-tenant Organization list | Operator-only PII (pending admin-invitation emails of ownerless Organizations) | `/operator`                                  |

## STRIDE analysis

### Spoofing

| Threat                                | Mitigation                                                                                                                                 | Status      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| Attacker registers without invitation | `identity.register` capability off by default; route checks `assertGlobalCapability`                                                       | ✅ Enforced |
| Attacker forges session token         | Better Auth session validation; httpOnly + secure cookies; no token in URLs                                                                | ✅ Enforced |
| Attacker spoofs forwarding headers    | Railway mode ignores XFF and requires the documented X-Real-IP + Railway marker contract; generic XFF mode validates/bounds the full chain | ✅ Enforced |
| Google webhook impersonation          | Pub/Sub JWT verification (`pubsub-jwt.verifier.ts`)                                                                                        | ✅ Enforced |

### Tampering

| Threat                                 | Mitigation                                                                                                                                    | Status      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Attacker modifies another org's data   | 84 repository test files carry two-organization fixtures; `src/shared/architecture/tenant-predicate-canary.test.ts` is the mechanical floor   | ✅ Enforced |
| Attacker bypasses authorization        | Server functions use `requireExecutionAllowed` (`src/shared/auth/execution-policy.ts`) or purpose-built seams; no direct role gates           | ✅ Enforced |
| Replay of outbox events                | `event_consumer_receipts` for idempotency; lease-based claiming                                                                               | ✅ Enforced |
| Review content modified after fetch    | `content_hash` column; source content TTL enforcement                                                                                         | ✅ Enforced |
| Beta feedback triage history rewritten | Revision guard, optimistic concurrency, immutable transition trigger, unique reference/revision evidence, and idempotent exact transition IDs | ✅ Enforced |

### Repudiation

| Threat                               | Mitigation                                                | Status             |
| ------------------------------------ | --------------------------------------------------------- | ------------------ |
| User denies performing action        | `audit_logs` with userId, ipAddress, action, resourceType | ✅ Enforced        |
| Operator denies capability change    | Capability decision log (identifiers + reason codes only) | 🔄 Logging pending |
| Reply publish denied/failed silently | Outbox facts + BullMQ job status + reconciliation records | ✅ Enforced        |

### Information Disclosure

| Threat                                        | Mitigation                                                                                                                                                                                                                                                                                                                        | Status                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Error responses leak internals                | `throwContextError` maps each tagged error once, sending its code and authored message and only logging its context; `catchUntagged` logs any untagged failure and returns a generic 500 `InternalError`; production error boundaries render a generic message. No text scrubbing runs (residual risk 5)                          | ✅ Enforced                                    |
| Logs contain secrets/PII                      | Pino structured logging; redaction patterns for tokens, emails, cookies                                                                                                                                                                                                                                                           | ✅ Module exists                               |
| Review text in outbox events                  | Identifier-only payloads per ADR 0030; content stripped by adapter                                                                                                                                                                                                                                                                | ✅ Enforced                                    |
| CSP bypass via injection                      | Default-deny CSP; inline styles only (Vite requirement); no inline scripts                                                                                                                                                                                                                                                        | ✅ Enforced                                    |
| Guest IP exposed                              | Raw IP never persists; a versioned Organization/Portal/action/UTC-day HMAC enters only the content-free pressure authority, becomes unusable at exact seven-day expiry, and is removed by bounded cleanup                                                                                                                         | ✅ Enforced                                    |
| Guest pressure becomes identity/analytics     | No session, destination, source fact, content, rating, or staff field exists in the pressure table; it has no analytics/staff-attribution reader and legacy per-fact writers are closed                                                                                                                                           | ✅ Enforced                                    |
| Cross-tenant data in dashboard                | Property-scoped queries; no org-level aggregation without authorization                                                                                                                                                                                                                                                           | ✅ Enforced                                    |
| Sensitive content sent through beta feedback  | Explicit privacy notice; Suggestion is strict text-only; Bug attachment accepts only quantized geometry/closed block kinds after explicit create action on allowlisted routes; server renders the fixed SVG; no account/contact fields, pixels, ordinary screenshot, replay, request body, text/value, URL, image, or media bytes | ✅ Enforced locally; provider controls pending |
| Raw tenant/user identifiers exposed to Sentry | Audience-separated HMAC pseudonyms and controlled route templates only                                                                                                                                                                                                                                                            | ✅ Enforced                                    |
| Feedback content copied into triage storage   | PostgreSQL schemas and repository interfaces contain only pseudonyms, enums, safe references, clocks, and revision evidence; report text and attachment bytes remain provider-side                                                                                                                                                | ✅ Enforced                                    |

### Denial of Service

| Threat                             | Mitigation                                                                                                                                                                                            | Status         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Burst of reviews overwhelms sync   | BullMQ bounded concurrency; outbox SKIP LOCKED claiming                                                                                                                                               | ✅ Enforced    |
| Dashboard query timeout under load | Incremental rollup tables; dashboard cache with TTL                                                                                                                                                   | ✅ Implemented |
| GBP rate limit (429)               | Retry with backoff; sync paused on rate limit                                                                                                                                                         | ✅ Enforced    |
| Large payload body                 | `REQUEST_BODY_LIMIT_BYTES` enforced pre-routing (`server/plugins/request-guard.ts`) and proved 413 against the booted artifact                                                                        | ✅ Enforced    |
| Guest public-action flood          | Signed-session and Portal-scoped Redis budgets precede a serialized PostgreSQL pressure authority; submissions fail closed, qualified scans retry, and navigation remains available without analytics | ✅ Enforced    |
| Beta feedback submission flood     | Shared Redis actor-first 5/hour and Organization 20/day budgets; production fails closed                                                                                                              | ✅ Enforced    |

### Elevation of Privilege

| Threat                                                               | Mitigation                                                                                                                                                                                                                                                                            | Status                                                                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Non-owner accesses admin functions                                   | AccountAdmin / PropertyManager beta roles (`isBetaInteractiveMemberRoleToken`) plus per-permission scope                                                                                                                                                                              | ✅ Enforced                                                                                                   |
| Custom role grants unexpected permission                             | Provider `dynamicAccessControl: { enabled: false }`; custom-role schema remains dormant                                                                                                                                                                                               | ✅ Enforced                                                                                                   |
| Last owner removed/demoted                                           | `member_last_owner_upd` trigger prevents removal                                                                                                                                                                                                                                      | ✅ Enforced                                                                                                   |
| Worker job runs for disabled capability                              | Jobs re-check capability before side effects                                                                                                                                                                                                                                          | ✅ Enforced                                                                                                   |
| API route discovered despite UI disabled                             | Routes and APIs require capability and authorization checks                                                                                                                                                                                                                           | ✅ Enforced (dark-capability-enforcement.test.ts, dark-context-matrix.test.ts)                                |
| Stolen operator session mints an Organization or invites an attacker | Verified-email allowlist (`OPS_OPERATOR_IDENTITIES`, fail-closed when absent); a session signed in within 30 minutes for every change; the console acts only on Organizations with no AccountAdmin; 30 changes per hour per operator; one content-free log line per change (ADR 0063) | ✅ Enforced (`platform-operator-access.server.test.ts`, `platform-administration.test.ts`); no MFA — residual |

## Residual risks

1. **Tenant-isolation regression floor** — 84 repository test files carry two-organization fixtures; `src/shared/architecture/tenant-predicate-canary.test.ts` is the mechanical floor.
2. **Auth endpoint abuse** — the shared Redis limiter guards sign-in, registration, invitation send/resend, guest submissions and the better-auth catch-all, and fails closed in production; Better Auth's native limiter also uses atomic Redis storage across replicas (`docs/operations/runbooks.md` §Security posture). Raw self-service sign-up is refused at the HTTP boundary (invite-only beta), and so is the raw verification-email send: the app-owned `resendVerificationEmail`, limited per IP and per pseudonymised address, is the only way to request a new link (ADR 0062). Residual: no proxy-level rate limiting in front of the app.
3. **Supply chain** — Dependabot configured but initial advisory scan returned 0 vulnerabilities; continuous monitoring needed.
4. **Manager-entered feedback content and provider proof** — a manager can
   disregard the notice and type personal/customer content that pattern
   scrubbers cannot reliably classify. The optional Bug layout is locally
   limited to quantized geometry and cannot carry pixels/text/values/media, but
   Sentry-project placement (US region), inbound scrubbers, operator access, event
   retention, attachment deletion within 30 days, alert receipt, and supported-
   device inspection remain external release evidence. SDK Replay and ordinary
   screenshots remain prohibited.
5. **Error message text** — no runtime scrubber rewrites error messages. A
   tagged error's authored message reaches the client, so a message must never
   interpolate user content or secrets; that is a review rule, not a check.
   Better Auth `APIError`s surface the library's own message or a status-keyed
   fallback. Invited registration returns fixed copy only
   (`src/contexts/identity/application/use-cases/register-invited-user.ts`);
   provider and driver text never reaches the client.
   The invitation preview (`getInvitationPreview`) is an anonymous,
   rate-limited read keyed by the invitation ID, which is a bearer secret
   already mailed to the invitee. It returns only what the invitation email
   states plus whether the address has an account; unknown IDs and ineligible
   invitations return one identical `unavailable` shape.

## OWASP ASVS 5.0 mapping

| ASVS area             | Coverage                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| V1 (Architecture)     | Bounded contexts, authorization policy, capability controls                                             |
| V2 (Authentication)   | Better Auth, email verification, session management                                                     |
| V3 (Session)          | httpOnly/secure cookies, session expiry, per-request permission_version re-read (cookie cache disabled) |
| V4 (Access Control)   | AuthorizationPolicy, property scoping, negative tests                                                   |
| V5 (Validation)       | Zod env validation, input validation at API boundaries                                                  |
| V7 (Logging)          | Structured logging, redaction patterns, operational records                                             |
| V8 (Data Protection)  | Encryption at rest (OAuth tokens), TTL on review content                                                |
| V9 (Communications)   | TLS via proxy, CSP, HSTS                                                                                |
| V12 (Files/Resources) | Upload capability disabled; private `cell-us` Railway bucket objects when enabled                       |
| V14 (Configuration)   | Env validation, least-privilege CI, CODEOWNERS                                                          |
