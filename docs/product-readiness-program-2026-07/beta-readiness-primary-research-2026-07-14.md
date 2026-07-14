# Beta-readiness primary-source research

**Repository:** `rep-key`  
**Research date:** 2026-07-14  
**Target:** controlled internal-team beta using real hotel/property accounts and real Google Business Profile reviews  
**Expected scale:** 5,000 properties and approximately 500,000 reviews per month  
**Stack observed:** TypeScript, TanStack Start, React, Vite/Nitro, Better Auth, PostgreSQL/Neon, Redis, BullMQ, Resend, S3-compatible object storage, Railway, GitHub Actions

## Purpose and interpretation

This brief records the primary-source evidence that should constrain a beta-readiness plan. It is not a complete code review and it is not legal advice. Legal applicability, controller/processor roles, and contractual terms must be confirmed by qualified counsel and by the product's agreements with customers and vendors.

The labels below deliberately separate obligations from engineering choices:

- **Vendor requirement** — a condition imposed by a platform whose API or service the product uses. Violation can lead to loss of access even when the code is otherwise secure.
- **Legal requirement if applicable** — a statutory duty whose applicability depends on facts such as the parties, jurisdiction, processing purpose, and business thresholds.
- **Normative standard** — a requirement only when the product commits to that standard, a contract requires it, or a law incorporates it.
- **Beta gate** — a product-specific release condition recommended for this real-data beta.
- **Recommendation** — valuable engineering work, but not necessarily a reason to stop a tightly controlled beta by itself.
- **Decision/verification needed** — evidence or a product/legal decision is still missing.

## Executive conclusion

Calling the audience “internal” does not make this a disposable test environment. Once real property accounts, Google access tokens, staff identities, reviewer names, review text, and reply actions enter the system, the beta is operating a production-like data-processing service. The correct risk boundary is the data and external side effects, not the number of people using the UI.

The following are beta blockers:

1. **Google Business Profile policy resolution.** Google's published policy limits stored API content to temporary storage for no more than 30 calendar days and says it may not be manipulated or aggregated. The current product model persists reviews and the planned trend analysis aggregates them. Written clarification or approval from Google is therefore a hard dependency, not a later optimization.
2. **Proven tenant isolation.** Every authenticated operation, background job, cache entry, object-storage key, export, and aggregate must be scoped by organization and property, with negative cross-tenant tests. UI route guards are not an authorization boundary.
3. **A lawful and documented real-data operating model.** Before onboarding a property, the team needs the appropriate customer agreement/DPA, privacy disclosures, a data map, retention and deletion rules, subprocessor and transfer decisions, access controls, and an incident/breach procedure.
4. **A single, tested migration path.** CI currently uses `db:push` even though `drizzle.config.ts` says production uses committed migrations plus Better Auth migrations and raw-SQL sidecars. A clean installation and an upgrade from a production-like snapshot must use the exact deployment path.
5. **Recoverability demonstrated by restoration.** A provider's backup checkbox is not proof of recovery. The team must define an initial RPO/RTO, restore a database and critical configuration into an isolated environment, and record the result.
6. **Durable external-event handling.** Google Pub/Sub push is at-least-once for this design, and reply/email jobs can be retried. Durable receipt, idempotency, bounded retries, failed-job retention, replay tools, and operator runbooks are required before real side effects.
7. **A reproducible deployable web service and worker.** Both builds must be hard CI gates, deployments need readiness checks and safe migrations, and the worker needs health/lag monitoring plus bounded graceful shutdown.

The product has useful foundations: explicit contexts, domain/application/infrastructure separation, structured logging, environment validation, tenant middleware, a Pub/Sub JWT verifier, retry-aware jobs, many unit tests, and some idempotency constraints. The readiness plan should preserve those foundations while tightening the system boundaries around them.

## Repository observations that affect the plan

These are observations from the repository snapshot, not conclusions from documentation alone.

| Area                      | Repository evidence                                                                                                                                                                                                                | Consequence                                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI database setup         | `.github/workflows/ci.yml` and the E2E job run `db:push` followed by `auth:migrate`; `drizzle.config.ts` explicitly says not to use `db:push` for business tables and defines a different deploy order including raw-SQL sidecars. | CI is not proving the deployment migration path and can conceal drift.                                                                                                                                    |
| Build gates               | CI does not run the production web build or worker build. Storybook build and E2E are `continue-on-error`.                                                                                                                         | Merge success does not prove that either production artifact starts or that core journeys work.                                                                                                           |
| Vite 8                    | `vite.config.ts` uses `build.rollupOptions`; current Vite build documentation uses `build.rolldownOptions` for Vite 8.                                                                                                             | Treat a clean production build and start smoke test as immediate blockers; update configuration based on the installed Vite version rather than compatibility assumptions.                                |
| Environment loading       | Vite calls `loadEnv(..., '')`, which loads every prefix into `process.env`. Import protection exists, which is good, but client exposure still requires a bundle inspection and explicit public/server env separation.             | Add a client-bundle secret scan and separate public config from server secrets.                                                                                                                           |
| Runtime                   | `railway.json` defines one replica, Nixpacks, and `ON_FAILURE` with 10 retries; no healthcheck path, start command, worker service, or pre-deploy migration command is declared in the file.                                       | Railway dashboard state may be carrying critical undocumented configuration. Export it to code or a runbook and test it. One replica is a conscious beta availability risk.                               |
| Health                    | `/api/health` returns 503 unless both PostgreSQL and Redis respond. `REDIS_URL` is optional in configuration even though jobs require it.                                                                                          | Split liveness, readiness, and detailed dependency health. Decide whether Redis loss should remove web traffic or merely disable degraded features.                                                       |
| Redis                     | Cache, rate limiting, and BullMQ all derive from one `REDIS_URL`; BullMQ uses separate connections but not a separate service/credential.                                                                                          | Queue persistence/no-eviction requirements conflict with cache eviction. Use distinct durable-queue and disposable-cache Redis services or, at minimum, independently governed instances and credentials. |
| Rate limiting             | The shared limiter fails open when Redis is missing or errors. Auth POSTs use `x-forwarded-for` without an observed trusted-proxy allowlist.                                                                                       | Fail-open may be acceptable for ordinary authenticated reads, but public/auth/write/expensive endpoints need explicit policies and a trusted client-IP source.                                            |
| Auth                      | Better Auth cookies are `Secure` only in production and `HttpOnly`/`SameSite=Lax`; sessions last 30 days with a 5-minute cookie cache. Email verification is feature-gated and not guaranteed on.                                  | Verify production origin/proxy/cookie behavior, session revocation, role-change freshness, account recovery, and email verification before real users.                                                    |
| Better Auth route wrapper | Raw organization writes are blocked by a hand-maintained path list whose comment refers to a different Better Auth version than `package.json`.                                                                                    | Add a version-pinned integration test that enumerates the mounted auth routes or otherwise proves that bypass routes remain blocked after dependency updates.                                             |
| Pub/Sub webhook           | JWT issuer, audience, algorithm, token age, and signature are checked. The verifier does not currently assert the expected push service-account identity, and the route performs downstream work before acknowledging.             | Add expected service-account/email checks, durable receipt and message-ID uniqueness, then acknowledge quickly and process asynchronously.                                                                |
| Job operations            | Workers have retries/backoff and signal handlers. Failed jobs are retained only by a small count, and `worker.close()` has no application timeout. No queue-age/DLQ operator surface was observed.                                 | Add failed-job persistence/replay, queue SLO metrics, and a bounded shutdown policy so deploy termination cannot hang indefinitely.                                                                       |
| Observability             | Pino and AsyncLocalStorage-style context exist. Sentry is optional and described as later work; a complete metrics/traces/export pipeline was not observed.                                                                        | Establish production logs, metrics, traces, redaction, retention, alerting, and ownership before onboarding properties.                                                                                   |
| File uploads              | The application uses presigned uploads and an image-processing job.                                                                                                                                                                | Presigning is not sufficient validation: authorization, size/type/signature checks, ownership binding, private storage, parser isolation, and orphan cleanup still need proof.                            |
| Tests                     | The repository contains many unit tests and nine E2E specs, but E2E is non-blocking due to known seeded/runtime problems.                                                                                                          | Fix deterministic fixtures and make a small set of critical cross-tenant and external-side-effect journeys blocking before broadening UI coverage.                                                        |

## 1. Security baseline and tenant isolation

### Primary-source basis

- The [OWASP Application Security Verification Standard 5.0](https://owasp.org/www-project-application-security-verification-standard/) is a structured verification catalogue for application security controls. Adoption is voluntary unless a contract or policy makes it mandatory.
- The [OWASP API Security Top 10 (2023)](https://owasp.org/API-Security/editions/2023/en/0x11-t10/) places broken object-level authorization, broken authentication, broken object-property authorization, unrestricted resource consumption, broken function authorization, SSRF, misconfiguration, inventory problems, and unsafe API consumption among the dominant API risks.
- OWASP's [Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) recommends least privilege, deny-by-default behavior, authorization on every request, and automated authorization tests. It also explains why attribute- or relationship-based checks fit object-rich systems better than relying only on coarse roles.
- NIST's [Secure Software Development Framework, SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final) organizes secure development around preparing the organization, protecting software, producing well-secured software, and responding to vulnerabilities.
- OWASP's [Threat Modeling project](https://owasp.org/www-project-threat-modeling/) frames the work around what is being built, what can go wrong, what mitigations exist, and whether they are effective.

### Requirements and consequences

**Beta gate — define the security verification target.** Adopt an explicitly scoped ASVS 5.0 baseline for the beta, preferably an L2-equivalent selection for authenticated SaaS functionality. Record excluded requirements and reasons; do not claim “ASVS compliant” without mapped evidence.

**Beta gate — threat-model the actual system.** At minimum cover:

- tenant/org/property boundary crossing;
- account takeover, invitation abuse, role escalation, stale session/permission caches, and last-owner removal;
- OAuth token theft or misuse;
- forged/replayed Pub/Sub and Resend webhooks;
- duplicate reply publication or email sends;
- public portal abuse, enumeration, spam, and denial of service;
- presigned-upload abuse, malicious images, parser exploitation, and public-object disclosure;
- secret leakage into Vite client bundles, logs, traces, job payloads, CI artifacts, or error pages;
- destructive test/maintenance commands pointed at production;
- compromised dependency, workflow, CI token, or deployment credential;
- insider access to real review and staff data.

**Beta gate — prove every tenant boundary.** Create an authorization matrix by resource and action, then automated negative tests that use valid credentials from tenant A against tenant B's organization IDs, property IDs, review IDs, reply IDs, team/member IDs, portal IDs, object keys, cache keys, job IDs, aggregates, exports, and URLs. A valid session with the wrong tenant must fail indistinguishably from an absent resource where appropriate.

**Beta gate — enforce scoping in depth.** Application/repository queries should require an `AuthContext` or an explicitly validated system actor and include organization/property predicates in the same query that fetches or mutates the resource. Avoid “load by ID, then compare” patterns when a scoped query is possible. Consider PostgreSQL row-level security as a second layer only after its operational and migration implications are understood; application checks remain necessary.

**Recommendation — security invariants in the database.** Where relationships permit it, use composite foreign keys or unique constraints that make an organization/resource mismatch impossible, rather than relying only on denormalized `organization_id` values that can drift. Audit every table carrying both a parent foreign key and a separate organization/property field.

**Beta gate — privileged operations and internal access.** Require individual accounts, MFA for team administrators/operators, least-privilege roles, no shared production accounts, auditable support access, and a break-glass procedure. Production database access should be time-bounded and reviewed.

**Beta gate — security logging.** OWASP's [Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) supports structured security events. Log authentication outcomes, role/membership changes, property connection/disconnection, OAuth grant/revoke, reply publish attempts/results, destructive administration, exports/deletions, and denied cross-scope attempts. Do not log credentials, tokens, raw cookies, full review content, guest email, webhook bodies, or presigned URLs.

**Recommendation — HTTP response policy.** Establish HSTS, CSP, frame restrictions, MIME sniffing prevention, referrer policy, permissions policy, and safe cache headers using the [OWASP HTTP Headers Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html) and [CSP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html). Roll CSP out in report-only mode first, then enforce after resolving violations.

## 2. TanStack Start, request boundaries, cookies, and proxies

### Primary-source basis

- TanStack's [Server Functions guide](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions) treats server functions as externally callable server endpoints. It documents input validation, authentication middleware, CSRF middleware, and response caching.
- TanStack's [Authentication overview](https://tanstack.com/start/latest/docs/framework/react/guide/authentication-overview) calls out HTTPS, strong secrets, secure cookies, authentication on private endpoints, validation, rate limiting, CSRF protection, and authentication logging for production.
- TanStack's [Import Protection guide](https://tanstack.com/start/latest/docs/framework/react/guide/import-protection) addresses preventing server-only code from reaching client bundles.
- Better Auth's [Security reference](https://better-auth.com/docs/reference/security) documents CSRF/origin protection, secure cookies, OAuth state/PKCE, trusted origins, and proxy considerations. Its [rate-limit documentation](https://www.better-auth.com/docs/concepts/rate-limit) warns that in-memory state is not suitable for distributed/serverless deployments.

### Requirements and consequences

**Beta gate — inventory the real endpoints.** Generate a machine-readable inventory of every TanStack server function, API route, public route, Better Auth route, webhook, and object-storage operation. For each, record actor, validation schema, authentication, authorization scope, CSRF/origin behavior, rate limit, cache policy, external side effects, and audit event.

**Beta gate — validate at the server boundary.** Every server function and route accepts untrusted input regardless of TypeScript types. Parse identifiers, enums, pagination, strings, file metadata, dates, and payload sizes with a runtime schema before invoking application logic. Reject unknown fields for mutation payloads where silent acceptance would be dangerous.

**Beta gate — route guards are UX, not authorization.** `beforeLoad` and hidden buttons may improve the UI, but each private server function/route must authenticate and authorize independently. Add direct invocation tests that bypass the rendered route.

**Beta gate — cookies and origin policy.** In production verify, using an actual deployed response, that session cookies have `Secure`, `HttpOnly`, an appropriate `SameSite` policy, expected domain/path, and no accidental cross-subdomain scope. Configure exact production trusted origins; do not include localhost or wildcard origins. Test sign-in, OAuth callback, sign-out, password reset, session expiry, organization switching, and cross-site requests behind Railway's proxy.

**Beta gate — trusted proxy handling.** Do not trust arbitrary client-supplied `X-Forwarded-For`, `X-Forwarded-Proto`, or host headers. Document Railway's forwarding chain and accept proxy-derived values only from the known platform boundary. Base rate-limit identity on a normalized, trustworthy client IP plus account/device signals where relevant. Host allowlisting must include Railway's documented healthcheck host only where needed.

**Beta gate — session invalidation.** Role downgrade, member removal, organization disconnection, password reset, suspected compromise, and user deletion must revoke or invalidate relevant sessions quickly. The 5-minute cookie cache and 60-second tenant cache need tests proving the intended upper bound. Thirty-day sessions are a product security decision, not a neutral default.

**Recommendation — stronger authentication.** Require MFA for owners/admins and internal operators before expanding beyond a very small beta. Consider passkeys or TOTP based on Better Auth's supported, documented configuration; preserve recovery controls and audit them.

**Beta gate — distributed rate limiting.** Auth, invitations, password reset, public portal submissions, click tracking, webhooks, uploads/presigning, imports, exports, and future AI endpoints need independent limits. A generic fail-open limiter must not be the sole protection for abuse-sensitive or cost-bearing operations. Define fail-open/fail-closed/degraded behavior per endpoint.

**Beta gate — private caching.** Authenticated HTML/data must not be placed in shared/public caches. Use private or `no-store` policies unless a tenant- and user-scoped cache design is proven. Ensure cache keys carry organization/property and permission-version dimensions.

## 3. Google Business Profile: policy and integration constraints

### Primary-source basis

- Google's [Business Profile API policies](https://developers.google.com/my-business/content/policies) are vendor requirements. They require authorization to manage listings and to respond to reviews, require a quick disassociation path, prohibit automatic review replies without the user's prior specific and express consent, and impose strict content-storage limits.
- Google's [OAuth app-state overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) distinguishes Internal from External apps. An Internal app is only for users in the same Workspace organization. An External app in Testing is limited to explicitly allowed test users, with a 100-test-user cap; production use and sensitive/restricted scopes can require verification. Google also documents the refresh-token consequences of testing state and Workspace administrator controls.
- Google's [OAuth 2.0 policies](https://developers.google.com/identity/protocols/oauth2/policies) and [sensitive-scope verification guide](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) require the narrowest scopes and production-readiness disclosures appropriate to the requested access.
- The [GBP quota documentation](https://developers.google.com/my-business/content/limits) requires clients to respect per-API limits and handle quota errors; actual project quotas must be verified in Google Cloud Console.
- Google Cloud's [authenticated Pub/Sub push guide](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions) requires verification of the signed token, including audience and the expected service-account identity.
- Pub/Sub [exactly-once delivery](https://cloud.google.com/pubsub/docs/exactly-once-delivery) is not available for push subscriptions. [Retry](https://cloud.google.com/pubsub/docs/subscription-retry-policy) and [dead-letter](https://cloud.google.com/pubsub/docs/handling-failures) behavior must be designed explicitly.

### Requirements and consequences

**Vendor requirement and beta blocker — resolve content use in writing.** Google's published policy says Business Profile API content may be stored only in limited amounts to improve project performance, temporarily for no more than 30 calendar days, securely, and without manipulation or aggregation. The product's review history, materialized metrics, sentiment, priority scoring, per-property themes, and trend reports appear to conflict with the plain published language. Do not infer permission from successful API access. Obtain and retain Google's written answer before using real GBP content for persistent history or AI aggregation.

**Vendor requirement — human authorization for replies.** Reply drafting may be automated, but publishing must remain an explicit human action tied to an authorized end-client unless Google gives a different written interpretation. Record who approved the publication, the exact content, property, review, timestamp, Google response, and idempotency key. Do not implement auto-publish as part of Phase 17.

**Vendor requirement — disconnection.** Provide a visible disconnect path and an operator-tested procedure that removes/relinquishes relevant permissions and disassociates the client within Google's required seven-business-day window. Define what local content and derived data are deleted immediately versus under a permitted retention period.

**Beta gate — OAuth production readiness.** Real properties outside the company's own Google Workspace make the app External, even if only internal employees operate the product. Decide whether the first beta can operate under External Testing constraints; do not rely on it for stable long-running imports without accounting for the documented refresh-token behavior. Complete branding, domain, privacy policy, authorized redirects, scope minimization, and verification work before it becomes necessary.

**Beta gate — webhook authenticity and durability.** Verify signature, issuer, audience, token age, and the exact configured Pub/Sub push service account. Persist a receipt keyed by subscription/message ID before acknowledging; return 2xx after durable acceptance, not after all downstream work. Process asynchronously, make the handler idempotent, retain failure evidence, and provide replay tooling. Never assume push is exactly-once.

**Beta gate — quota and backoff.** Measure API requests by project/account/location/operation, smooth imports rather than producing bursts, honor `429` and retry guidance with capped exponential backoff plus jitter, and expose a quota dashboard. A global worker concurrency of ten is not a complete per-Google-API rate-control design.

**Decision/verification needed — provenance and 30-day enforcement.** If Google permits temporary storage only, every stored item and derivative needs source/provenance, fetched-at, expiry, and deletion processing. Backups, caches, search indexes, logs, analytics, and materialized views must not silently extend prohibited retention.

## 4. Privacy, data governance, and real-hotel operations

### Primary-source basis

- The official [General Data Protection Regulation](https://eur-lex.europa.eu/eli/reg/2016/679/oj) includes purpose limitation, data minimization, storage limitation and accountability (Article 5), lawful bases (Article 6), transparency (Articles 13–14), individual rights (Articles 15–22), privacy by design/default (Article 25), processor obligations (Article 28), records of processing (Article 30), security (Article 32), breach notification where required (Article 33), impact assessments for qualifying high-risk processing (Article 35), and international-transfer rules (Chapter V).
- The European Data Protection Board's guidance on [securing personal data](https://www.edpb.europa.eu/sme/be-compliant/secure-personal-data_en), [personal-data breaches](https://www.edpb.europa.eu/topics/security-data-breaches/personal-data-breaches_en), and [international transfers](https://www.edpb.europa.eu/sme/be-compliant/international-data-transfers_en) provides regulator-authored operational guidance.
- California's Attorney General summarizes rights under the [CCPA](https://oag.ca.gov/privacy/ccpa). The California Privacy Protection Agency publishes the current [regulations](https://cppa.ca.gov/regulations/) and [2025 updates effective in 2026](https://cppa.ca.gov/regulations/ccpa_updates.html). Applicability and thresholds must be assessed from current law and the company's facts, not assumed from a generic checklist.

### Requirements and consequences

**Legal requirement if applicable — determine roles and lawful basis.** For each data flow, decide whether the company and hotel are controller, joint controller, or processor; document the purpose and lawful basis; and execute the necessary customer/DPA terms. Do this before importing real reviews, not after the beta.

**Beta gate — build a data inventory and lineage map.** Include:

- account, organization, member, role, invitation, and session data;
- property and Google connection metadata;
- encrypted OAuth access/refresh tokens and state material;
- reviewer name/photo/reference, rating, review text, timestamps, and reply text;
- guest portal sessions, ratings, free-text feedback, click/scan identifiers, and any IP/user-agent data;
- staff assignments, goals, activity, badges, leaderboards, notifications, and audit events;
- cache entries, queue payloads, logs, traces, error reports, analytics, email provider data, object storage, backups, exports, test fixtures, and future AI-provider inputs/outputs.

For every field, record source, purpose, tenant/property, sensitivity, region, system of record, recipients/subprocessors, retention, deletion propagation, and access roles.

**Legal requirement if applicable — transparency and rights.** Publish customer-facing and guest-facing notices appropriate to actual processing. Implement verified access/export, correction, deletion, restriction/objection, and opt-out/limitation flows where applicable. Define which party receives and fulfills requests, the response deadline, identity verification, and exception handling.

**Beta gate — retention is executable code.** Use a policy table plus scheduled deletion jobs and evidence reports. Cover primary rows, derived metrics, caches, BullMQ data, files, logs/traces, provider data, and backup expiry. “Delete from the UI” is not a deletion program.

**Legal requirement if applicable — subprocessors and international transfers.** Maintain a current list and agreements for hosting, database, Redis, object storage, email, observability, Google, and later AI providers. Map where each service processes and supports data. For EEA data transferred internationally, document the applicable Chapter V mechanism and any required transfer assessment/supplementary measures.

**Beta gate — internal data access.** Limit production visibility to named people with a work reason; log access; mask review text and identities in routine support/observability tools; and use synthetic or irreversibly de-identified data outside production unless an approved incident requires otherwise.

**Decision/verification needed — DPIA and CCPA applicability.** Counsel/privacy leadership should determine whether the planned automated sentiment/priority/trend processing, scale, monitoring, and international transfers trigger a DPIA or California risk-assessment/cybersecurity-audit duties. Document the decision even if the answer is no.

**Beta gate — breach readiness.** Maintain a personal-data incident register and a decision path that can meet GDPR's 72-hour supervisory-authority deadline when notification is required. The internal incident process must identify affected tenants/properties, data categories, regions, processors, and containment actions quickly.

## 5. PostgreSQL, migrations, destructive-test isolation, and recovery

### Primary-source basis

- PostgreSQL documents [continuous archiving and point-in-time recovery](https://www.postgresql.org/docs/current/continuous-archiving.html), regular [database maintenance](https://www.postgresql.org/docs/current/maintenance.html), [statistics monitoring](https://www.postgresql.org/docs/current/monitoring-stats.html), and [lock monitoring](https://www.postgresql.org/docs/current/monitoring-locks.html).
- PostgreSQL's [role-attribute documentation](https://www.postgresql.org/docs/current/role-attributes.html) warns that superusers bypass permission checks and should not be used casually.
- PostgreSQL's [ALTER TABLE documentation](https://www.postgresql.org/docs/current/ddl-alter.html) explains that schema changes can scan tables and acquire locks, which is why production migrations require operational planning.
- Drizzle's official [Kit overview](https://orm.drizzle.team/docs/kit-overview), [`migrate`](https://orm.drizzle.team/docs/drizzle-kit-migrate), and [`push`](https://orm.drizzle.team/docs/drizzle-kit-push) documentation distinguish committed generated migrations from direct schema synchronization.
- Neon documents [pooled versus direct connections](https://neon.com/docs/connect/connection-pooling) and project/network controls in its [project documentation](https://neon.com/docs/manage/projects). Provider plan, retention, restore granularity, and regional availability must be verified against the account before launch.
- GitHub documents disposable [PostgreSQL and Redis service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services) for workflow jobs.

### Requirements and consequences

**Beta gate — one migration authority and exact order.** Define a single command that applies, in order, Better Auth schema changes, committed Drizzle migrations, and versioned raw-SQL migrations. Every migration must be recorded once and be safely repeatable or explicitly guarded. Replace timestamp-less/ad-hoc sidecar execution with a journaled mechanism.

**Beta gate — CI proves clean install and upgrade.** Run two independent jobs:

1. initialize a blank disposable PostgreSQL service exclusively through the production migration command, then run schema verification and tests;
2. restore a sanitized prior-release schema/data fixture, apply the same command, run invariants and critical journeys, and inspect lock/runtime expectations.

`db:push` may remain a local prototyping tool only if it is impossible to invoke against beta/production and is not used as deployment evidence.

**Beta gate — destructive test isolation.** Enforce all of the following:

- tests receive only ephemeral service-container credentials, never staging or production secrets;
- CI's test database role is non-superuser, has no network route or credentials to production, and owns only the disposable test database;
- destructive scripts require `NODE_ENV=test`, an explicit random test database name/prefix, and a second marker such as `ALLOW_DESTRUCTIVE_DB_TESTS=1`;
- the guard rejects known production/staging hosts and databases, loopback assumptions are tested, and the safety check itself has unit tests;
- production secrets exist only in a protected GitHub/Railway environment and are unavailable to pull-request jobs;
- local tests default to a disposable container or dedicated local database, never whatever `DATABASE_URL` happens to be in a developer shell.

These controls are product recommendations derived from least privilege and environment separation; PostgreSQL does not provide a single universal “test database guard.”

**Beta gate — separate runtime and migration credentials.** The web and worker roles should be non-owner, non-superuser runtime roles with only required DML/sequence permissions. A distinct, tightly controlled migration role may own schema changes. Use Neon's pooled endpoint for ordinary runtime traffic where appropriate and a direct connection for migration/administration tasks that are incompatible with transaction pooling.

**Beta gate — connection and query budgets.** Define web/worker pool sizes against actual database compute limits, statement and lock timeouts, slow-query logging, and transaction-duration alerts. At 500,000 reviews/month the average arrival rate is modest, but imports and Pub/Sub bursts matter; test 10–100x average burst profiles and concurrent dashboard queries rather than sizing to monthly average.

**Beta gate — zero/low-downtime migration pattern.** Use expand/backfill/validate/contract for risky changes, avoid long transactions and table rewrites, measure on production-like cardinality, set lock timeouts, and prepare abort/rollback instructions. Serialize migration execution so concurrent deploys cannot apply it twice.

**Beta gate — backup and restore proof.** Define initial product targets (recommended starting point: RPO no more than 15 minutes, RTO no more than 4 hours for the controlled beta), verify the purchased Neon plan supports them, and perform a documented restore into an isolated project. Validate tenant counts, critical foreign keys, encrypted-token handling, application startup, and a representative read-only journey. Repeat at least quarterly and after material storage changes.

**Recommendation — independent logical backup.** In addition to provider PITR, retain encrypted, access-controlled, lifecycle-managed logical backups of essential configuration and business data in a separate failure domain, if allowed by Google and privacy retention rules. Backup retention must not violate content-deletion obligations.

## 6. Redis and BullMQ operations

### Primary-source basis

- Redis's [security documentation](https://redis.io/docs/latest/operate/oss_and_stack/management/security/) recommends trusted-network placement, TLS, authentication/ACLs, and unprivileged access.
- Redis documents [eviction policies](https://redis.io/docs/latest/develop/reference/eviction/) and [persistence trade-offs](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/). Cache eviction and durable queues have different operational requirements.
- BullMQ's [production guide](https://docs.bullmq.io/guide/going-to-production) calls for Redis persistence, `maxmemory-policy=noeviction`, appropriate retry behavior, error handlers, graceful termination, and careful job-data handling.
- BullMQ documents [graceful worker shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown), [idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs), [retries/backoff](https://docs.bullmq.io/guide/retrying-failing-jobs), and [telemetry](https://docs.bullmq.io/guide/telemetry).

### Requirements and consequences

**Beta gate — split durability classes.** Use a dedicated BullMQ Redis with private networking, TLS, ACL credentials, persistence/high availability appropriate to the beta, and `noeviction`. Use a separate cache/rate-limit Redis with an explicit eviction policy and independent failure behavior. Different logical database numbers on one maxmemory instance do not isolate eviction or failure.

**Beta gate — job payload minimization.** Store immutable IDs, tenant/property routing metadata, event ID, attempt/version, and trace context; load sensitive content from PostgreSQL inside the authorized worker transaction. BullMQ job data is visible in Redis and operator tooling and should not contain review text, email bodies, OAuth tokens, presigned URLs, or secrets.

**Beta gate — idempotency at the side-effect boundary.** Each publish-reply, send-email, import-page, notification, materialized-refresh, and future AI job must have a stable idempotency key backed by a database uniqueness constraint or external provider key. Retrying must not duplicate a Google reply, email, notification, or derived record.

**Beta gate — failure lifecycle.** Define retryable versus terminal errors, capped exponential backoff with jitter, maximum attempts, a durable failed/dead-letter state, retention long enough for investigation, redrive tooling, and a poison-message quarantine. Keeping only the last 50 failed BullMQ jobs is not sufficient operational evidence.

**Beta gate — graceful deploys.** Stop accepting jobs, close workers, and wait only up to a configured termination budget; if exceeded, log/trace the in-flight jobs and allow the platform to terminate so BullMQ can recover stalled work. Test SIGTERM during long Google, email, database, and image-processing calls.

**Beta gate — queue health.** Alert on oldest waiting age, active duration, stalled count, failure/retry rate, completion rate, Redis memory/persistence status, and worker heartbeat. Health must be per queue and per external dependency, not merely Redis `PING`.

## 7. Webhooks, email, and external side effects

### Email primary-source basis

- Gmail's [sender guidelines](https://support.google.com/mail/answer/81126) require authentication and transport hygiene; requirements become stricter for high-volume senders. Even a low-volume beta should use SPF, DKIM, TLS, valid DNS, and a monitored sending identity.
- Resend's [domain documentation](https://resend.com/docs/dashboard/domains/introduction) covers domain verification and recommends a sending subdomain. Its [DMARC guide](https://resend.com/docs/dashboard/domains/dmarc) supports a monitored rollout.
- Resend's [idempotency-key documentation](https://resend.com/docs/dashboard/emails/idempotency-keys) says keys deduplicate equivalent sends for 24 hours and documents conflict behavior.
- Resend's [webhook verification guide](https://resend.com/docs/webhooks/verify-webhooks-requests) requires signature verification over the raw request body. Its [retry/replay documentation](https://resend.com/docs/webhooks/retries-and-replays) and [webhook ingester](https://resend.com/docs/webhooks/ingester) demonstrate unique event-ID deduplication and durable receipt.

### Requirements and consequences

**Beta gate — production domain and deliverability.** Use a dedicated transactional subdomain, publish/verify SPF and DKIM, add DMARC starting with monitored policy and progress based on reports, and configure a named From and monitored Reply-To. Separate transactional traffic from future marketing traffic.

**Beta gate — email outbox.** Persist the intended email and idempotency key before sending, use the same Resend idempotency key on retry, record the provider ID/result, and transition state transactionally where possible. Do not infer delivery from API acceptance.

**Beta gate — signed delivery webhooks.** Verify the raw body with the Resend signing secret, reject invalid/timestamp-expired signatures, persist the unique webhook event ID before 2xx, deduplicate retries, and process delivery/bounce/complaint/suppression updates asynchronously. Maintain a secret-rotation and replay runbook.

**Beta gate — suppression and privacy.** Stop sending to hard bounces/complaints, distinguish strictly transactional notices from marketing, and avoid embedding review text or guest identity in email unless the use case requires it and the disclosure/retention model permits it.

**Recommendation — synthetic delivery check.** Send a scheduled synthetic message through the production path to a controlled mailbox and alert on queue/API failures. Do not call inbox arrival an application SLO unless mailbox observation exists.

### Generic external-call controls

**Beta gate.** Every Google, Resend, S3, JWKS, and future AI request must have connection and total timeouts, bounded retries only for safe/retryable operations, exponential backoff with jitter, idempotency where side effects exist, circuit/degradation behavior, and structured metrics. AWS's [timeouts, retries, and backoff with jitter guidance](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/) explains why unbounded layered retries amplify outages.

## 8. File uploads, object storage, and SSRF

### Primary-source basis

- OWASP's [File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) recommends allowlisted extensions, MIME and file-signature checks, safe generated names, size limits, separate/private storage, authorization, CSRF protection, and safe parser handling.
- OWASP's [SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) recommends strict destination allowlisting and blocking internal, link-local, metadata, loopback, alternate-scheme, and redirect bypasses when the server fetches user-influenced URLs.
- AWS's [S3 security best practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html) recommend blocking public access, disabling ACL-based ownership where possible, least privilege, encryption, versioning where useful, monitoring, and lifecycle controls. AWS documents [presigned URL behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) and [aborting incomplete multipart uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html).

### Requirements and consequences

**Beta gate — presign authorization and namespace.** Generate object keys server-side from tenant/property/user plus a random ID. Before presigning, authorize the exact purpose and owner. Use short expiries, one permitted method, fixed content length range and content type where the provider supports conditions. Never accept a client-selected bucket or arbitrary key prefix.

**Beta gate — validate after upload before publication.** The finalize step must prove that the object exists at the expected key, size is within limits, file signature matches the small allowlist, dimensions/decompression ratio are safe, and the uploader still owns the target resource. Re-encode accepted images into a safe output format in an isolated worker; do not trust MIME or filename alone.

**Beta gate — private storage and retrieval.** Block public bucket access and ACLs. Serve through authorized short-lived reads or a controlled public derivative path only when the product explicitly needs a public portal image. A public URL must not expose adjacent tenant keys or original uploads.

**Beta gate — parser and resource limits.** Bound download bytes, pixels, frames, CPU, memory, and processing time. Keep Sharp and native dependencies patched. Quarantine or delete failures, and lifecycle-delete abandoned uploads and incomplete multiparts.

**Beta gate — SSRF.** Any image job or email attachment flow that fetches a URL must accept only objects from the product's own allowlisted storage origin/key, resolve and validate destinations safely, reject redirects to unapproved hosts, and block private/link-local/metadata IP ranges and non-HTTPS schemes. Prefer object-store SDK reads by key over arbitrary HTTP URLs.

**Recommendation — malware/content policy.** For the current image-only use case, safe re-encoding plus strict format limits may be proportionate. If documents or archives are later accepted, add malware scanning and a more isolated content-disarm pipeline.

## 9. Observability, sensitive telemetry, and service health

### Primary-source basis

- OpenTelemetry provides stable [semantic conventions](https://opentelemetry.io/docs/specs/semconv/), including [HTTP](https://opentelemetry.io/docs/specs/semconv/http/) and [messaging](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/) attributes.
- OpenTelemetry's [handling sensitive data guidance](https://opentelemetry.io/docs/security/handling-sensitive-data/) recommends avoiding collection where possible and using processors to filter, redact, hash, or truncate sensitive attributes. Its [collector hosting guidance](https://opentelemetry.io/docs/security/hosting-best-practices/) covers securing telemetry transport and access.
- Google SRE's [monitoring distributed systems](https://sre.google/sre-book/monitoring-distributed-systems/) distinguishes actionable symptom-based signals from noisy implementation telemetry.

### Requirements and consequences

**Beta gate — provider-neutral signals.** Instrument web requests, server functions, database calls, BullMQ enqueue/process/retry, Google calls, Pub/Sub receipt-to-completion, Resend calls/webhooks, S3/image jobs, and deployment version using OpenTelemetry/OTLP or an equivalent exportable model. Pin a semantic-convention version to avoid attribute drift.

**Beta gate — correlation.** Carry a request/event/trace ID into durable job records and logs. Include organization/property only as internal identifiers and only where access to telemetry is restricted. Never use review text, reviewer names, email, OAuth tokens, cookies, URL query strings, webhook bodies, or presigned URLs as span/log attributes.

**Beta gate — cardinality budget.** Do not label metrics with user ID, review ID, job ID, raw error message, URL, or property slug. Use bounded dimensions such as service, environment, route template, queue, job type, dependency, region, and result class. IDs belong in sampled traces/logs, not time-series labels.

**Beta gate — three health surfaces.** Provide:

- **liveness:** process/event loop is alive; no remote dependency checks;
- **readiness:** this replica can accept its intended traffic, with only truly mandatory dependencies;
- **diagnostics/metrics:** authenticated or private detailed state for DB, Redis, queues, Google, email, storage, and build version.

Railway's [healthcheck documentation](https://docs.railway.com/deployments/healthchecks) says the configured endpoint is used while activating a deployment and is not continuous production monitoring. Therefore add independent uptime/synthetic monitoring after activation.

**Beta gate — log/telemetry operations.** Define retention, region, access control, deletion, sampling, redaction tests, dashboards, and alerts. Make redaction a unit-tested allowlist, not a request for developers to remember `maskEmail` manually.

## 10. Reliability, incident response, SLOs, and disaster recovery

### Primary-source basis

- NIST [SP 800-61 Rev. 3](https://csrc.nist.gov/pubs/sp/800/61/r3/final) integrates incident-response preparation, detection, response, recovery, and improvement into cybersecurity risk management.
- Google SRE's [Implementing SLOs](https://sre.google/workbook/implementing-slos/) recommends starting with a small number of user-centered indicators, choosing targets below 100%, and using error budgets. The [SLO alerting](https://sre.google/workbook/alerting-on-slos/) chapter describes multi-window burn-rate alerting.
- AWS's [Reliability Pillar](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html) emphasizes recovery, automated change, capacity management, and testing failure procedures.

### Recommended initial beta objectives

These are product recommendations, not statutory or vendor requirements. Confirm them with the beta promise and staffing reality.

| User/system outcome                | Suggested initial objective                                                                            | Measurement notes                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Authenticated web/API availability | 99.5% over a rolling 28 days                                                                           | Measure selected critical journeys at the edge; exclude only documented planned windows. |
| New-review freshness               | 95% visible within 15 minutes; 99% within 60 minutes of receipt/availability                           | Separate Google availability/notification delay from the app's receipt-to-visible time.  |
| Reply publication                  | 99% of accepted publish jobs reach a correct terminal result within 10 minutes                         | Never count duplicates as success; expose Google rejection separately.                   |
| Notification/email acceptance      | 99% of valid queued transactional emails accepted by Resend within 5 minutes                           | Provider acceptance is not inbox delivery.                                               |
| Queue processing                   | 99% of ordinary jobs start within their per-queue latency target                                       | Set distinct targets for urgent, default, and background/import queues.                  |
| Recovery point                     | no more than 15 minutes of committed data at risk                                                      | Verify against provider and application architecture.                                    |
| Recovery time                      | service restored within 4 hours                                                                        | Demonstrate in a restore exercise, including DNS/secrets/config.                         |
| Authorized deletion                | 99% completed within the policy's internal operational deadline; 100% within the legal/vendor deadline | Include derivatives, cache, files, and downstream processors.                            |

Cross-tenant unauthorized access and duplicate external side effects are **security/correctness invariants**, not error-budgeted SLOs. One confirmed case stops the beta, triggers incident handling, and requires root-cause remediation.

### Operational consequences

**Beta gate — ownership.** Name a primary and backup service owner, define support/on-call hours for the controlled beta, severity levels, contact tree, customer communication owner, and authority to disable imports, replies, email, or the whole service.

**Beta gate — runbooks.** At minimum: account compromise/session revoke; OAuth token compromise; Google API suspension/quota exhaustion; Pub/Sub backlog/DLQ replay; duplicate reply; Redis loss; database saturation; failed migration; rollback; restore; Resend outage/bounce spike; object-storage exposure; leaked secret; tenant data leak; property disconnect/delete.

**Beta gate — exercise, do not only document.** Run a restore drill, revoked-secret drill, worker-kill/redelivery drill, webhook replay drill, rollback drill, and tabletop privacy/security incident before the first property. Record elapsed time, missing access, and corrective work.

**Recommendation — error-budget policy.** A 99.5% 28-day objective permits roughly 3 hours 22 minutes of unavailability. Define when reliability work stops feature delivery, and page on fast/slow burn rather than every isolated error.

## 11. Accessibility and user-facing quality

### Primary-source basis

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) is the normative W3C recommendation. A claim of Level AA conformance requires satisfying all applicable Level A and AA success criteria across complete pages and processes.
- W3C explains that [WCAG techniques are informative](https://www.w3.org/WAI/WCAG22/Understanding/understanding-techniques.html); passing a favored technique is not the same as proving conformance.
- W3C's [evaluation report methodology/template](https://www.w3.org/WAI/test-evaluate/report-template/) supports a documented combination of automated and expert/manual evaluation.
- Storybook documents [accessibility testing](https://storybook.js.org/docs/writing-tests/accessibility-testing), and Playwright documents [test best practices](https://playwright.dev/docs/best-practices) and [browser-context isolation](https://playwright.dev/docs/test-isolation).

### Requirements and consequences

**Normative standard if adopted; recommended beta gate — WCAG 2.2 AA.** Set WCAG 2.2 AA as the product target for the complete critical flows: registration/login/recovery, invitation acceptance, organization/property selection, GBP connection/import, inbox/review detail, reply composition/publish, settings, public portal, feedback, and disconnect/delete.

**Beta gate — combine test methods.** Make automated accessibility checks blocking for components/pages, but also perform manual keyboard-only, focus order/visibility, screen-reader smoke, zoom/reflow, contrast, target-size, error-identification, status-message, and accessible-authentication tests. Automated tools cannot establish full conformance.

**Beta gate — real content resilience.** Test long property/reviewer names, translated text, emoji, right-to-left review content, empty/deleted Google fields, 1–5-star states, thousands of inbox items, narrow/mobile layouts, high zoom, reduced motion, and slow/error states. Never encode sentiment/priority/status by color alone.

**Decision/verification needed — legal accessibility duties.** US and European accessibility laws depend on entity and service facts. Counsel determines legal scope; the WCAG target remains a sound product requirement independently.

## 12. Performance and capacity

### Primary-source basis

- Google's [Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds) define “good” at the 75th percentile as LCP at or below 2.5 seconds, INP at or below 200 ms, and CLS at or below 0.1.
- Vite's [production build guide](https://vite.dev/guide/build.html) documents Vite 8 build configuration, modern browser targets, preload errors, and cache handling for deployed HTML/assets.
- Vite's [environment-variable guide](https://vite.dev/guide/env-and-mode.html) warns that client-exposed environment variables are bundled and must not contain secrets.
- TanStack Query's [SSR guide](https://tanstack.com/query/latest/docs/framework/react/guides/ssr) requires a per-request query client to prevent cross-user data sharing and discusses staleness, prefetching, and memory behavior.

### Requirements and consequences

**Beta gate — production build and startup.** On every pull request, build the web and worker artifacts from a frozen lockfile, start them with production settings, apply migrations to a disposable DB, call liveness/readiness, and execute a smoke journey. Inspect the browser bundle/source maps for server modules and secret patterns.

**Beta gate — SSR isolation.** Prove that query clients, auth state, and request context are created per request and cannot leak data between concurrent users/organizations. Add a concurrency test with interleaved tenant A/B SSR requests.

**Recommended target — Core Web Vitals.** Measure RUM for the beta and target “good” p75 LCP/INP/CLS on supported mobile and desktop. Lab tests are release signals; field data decides whether users meet the target.

**Beta gate — capacity model.** Convert 500,000 reviews/month into realistic arrival distributions: average is about 16,700/day, but initial imports, Pub/Sub fan-out, hotel time zones, and retries create bursts. Load-test at least:

- connection/import of multiple large properties;
- a 10–100x steady-state review burst;
- simultaneous inbox/dashboard reads during import;
- Redis/Google/Resend latency and transient failures;
- worker deployment during active jobs;
- materialized-view refresh and retention deletion;
- multiple properties sharing an organization without cross-scope cache errors.

**Recommendation — query/data-shape budgets.** Define maximum page size, cursor pagination, indexed sort/filter paths, dashboard query count/time, and payload size. Use `EXPLAIN (ANALYZE, BUFFERS)` on production-like data and track regressions. Materialized views and caches should be introduced only with freshness, tenant keying, invalidation, and failover behavior specified.

## 13. GitHub Actions and software-supply-chain controls

### Primary-source basis

- GitHub's [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) recommends least-privilege `GITHUB_TOKEN` permissions, full-length commit-SHA pinning for third-party actions, CODEOWNERS for workflow changes, and OIDC instead of long-lived cloud credentials.
- GitHub's [repository security quickstart](https://docs.github.com/en/code-security/getting-started/quickstart-for-securing-your-repository) covers Dependabot, dependency review, CodeQL, and secret scanning.
- GitHub's [supply-chain security guidance](https://docs.github.com/en/code-security/tutorials/implement-supply-chain-best-practices/securing-code) covers dependency review and software bills of materials. GitHub also supports [artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) where the plan and artifact type permit them.
- GitHub [deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) can restrict deployment branches, require reviewers, and withhold environment secrets until protection rules pass.

### Requirements and consequences

**Beta gate — workflow least privilege.** Add explicit top-level `permissions: { contents: read }` and narrower job overrides. Deployment jobs receive only the exact OIDC/environment permissions they need. PR test jobs receive no production/staging credentials.

**Beta gate — immutable actions.** Pin every external action, including GitHub-authored actions, to a full commit SHA and use Dependabot/Renovate to propose controlled updates. Tags such as `@v4` are movable and do not satisfy GitHub's strongest immutability guidance.

**Beta gate — security scanning.** Enable and make policy decisions for:

- CodeQL code scanning for JavaScript/TypeScript and workflow code;
- secret scanning and push protection;
- Dependabot alerts and security updates;
- dependency review on pull requests, blocking known severe vulnerable additions subject to documented exceptions;
- lockfile integrity and `pnpm install --frozen-lockfile`;
- SBOM generation for the production artifact/image;
- container/image scanning if containers become the deployment artifact.

Availability depends on repository ownership and GitHub plan; record unavailable controls and equivalent alternatives.

**Beta gate — branch and ownership protection.** Require reviewed pull requests, passing hard gates, resolved review conversations, signed/traceable changes as appropriate, and CODEOWNERS review for `.github/workflows`, auth, authorization, migrations, environment/deploy config, secrets, Google integration, and retention/deletion code.

**Beta gate — artifact provenance.** Build once, identify the artifact by immutable version/digest, deploy that artifact to beta, record source SHA and migration version, and promote rather than rebuild where the platform permits. Generate an SBOM; add artifact attestation if supported.

**Recommendation — dependency update policy.** Automate small, frequent patch updates with test gates; define SLA by severity for runtime dependencies and Node releases. Avoid `npx -y` fetching an unpinned latest CLI during migrations; install/pin migration CLIs in the lockfile or invoke an immutable tool artifact.

## 14. Runtime, Railway, and deployment topology

### Primary-source basis

- Node's [release schedule](https://nodejs.org/en/about/previous-releases) recommends production use of Active or Maintenance LTS lines. Runtime patch releases include security fixes, so the deployed image/runtime must be identifiable and updated.
- Railway's [pre-deploy command documentation](https://docs.railway.com/deployments/pre-deploy-command) states that the command runs after build and before deployment, in a separate container with environment variables; a non-zero exit prevents deployment.
- Railway's [healthcheck documentation](https://docs.railway.com/deployments/healthchecks) explains activation checks and explicitly says they are not continuous monitoring.
- Railway's [restart policy documentation](https://docs.railway.com/deployments/restart-policy) explains `On Failure`, `Always`, replica behavior, and plan limitations.
- Docker's [build best practices](https://docs.docker.com/build/building/best-practices/) recommend multi-stage builds, small trusted images, non-root execution, deliberate base-image pinning, and CI rebuild/testing. Docker is an option, not a requirement, if Railway's source-build artifact can be made equally reproducible.
- Kubernetes' [probe documentation](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes) is a useful primary explanation of liveness, readiness, and startup semantics even when Railway is the current platform.

### Requirements and consequences

**Beta gate — pin and inventory the runtime.** Choose an exact supported Node LTS patch for CI and deployment, record it in repository/tooling and the deployed artifact, and establish a monthly/security-triggered update process. CI's broad `node-version: 22` does not by itself prove the Railway runtime is the same patched release.

**Beta gate — two independently deployable services.** Define explicit build/start commands, environment variables, health signals, resources, and scaling for the web service and worker. A worker crash/restart policy must not accidentally restart or block the web service.

**Beta gate — migrations before traffic.** Use a serialized Railway pre-deploy command or dedicated release job for the one approved migration command. A failed migration must stop activation. Ensure application changes remain compatible with the prior schema during rolling/overlapping deployments.

**Beta gate — readiness before activation.** Configure Railway's healthcheck path and timeout. The endpoint must return 200 only when the new web artifact can serve ordinary traffic; add separate external continuous monitoring because Railway does not keep polling it after activation.

**Beta gate — rollback model.** Document which code releases can roll back without reversing schema, how feature flags disable new paths, and how to handle a migration that has changed data. “Redeploy old code” is unsafe if the schema is no longer backward compatible.

**Decision — replica count.** One web replica and one worker replica may be acceptable for a short, staffed internal beta if the availability promise reflects it and restart/restore paths are proven. Two web replicas reduce deploy and host-failure exposure but require distributed sessions/rate limits/caches to be correct. Scale only after those assumptions are tested.

**Recommendation — immutable container.** A multi-stage, non-root Docker image pinned by digest gives a clearer reproducibility/security boundary than unspecified Nixpacks behavior. If retaining Nixpacks/Railpack, pin the Node/package-manager versions, preserve build logs/SBOM, and prove identical web/worker artifacts and native dependencies.

## 15. Context-by-context beta risk lens

This is the minimum audit lens for every bounded context. It is not a substitute for reading every use case and repository query.

| Context        | Beta-readiness questions and evidence required                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `activity`     | Is the event ID unique per tenant? Are entries immutable enough for investigation, access-controlled, retention-limited, and free of raw sensitive payloads?                                           |
| `badge`        | Can awards or definitions cross properties? Are worker evaluations idempotent and permission-aware? Are staff performance implications disclosed and proportionate?                                    |
| `dashboard`    | Does every aggregate retain organization/property scope? Are cache/materialized-view keys and refreshes tenant-safe? Are freshness and empty/partial states explicit?                                  |
| `goal`         | Are parent/period uniqueness, recurrence, time zone/DST, and idempotent spawning enforced? Can a scoped member mutate another property's goals?                                                        |
| `guest`        | Are public submissions minimally collected, rate-limited, CSRF/automation resistant, accessible, retention-limited, and covered by a notice? Is cookie/consent behavior actually necessary and lawful? |
| `identity`     | Are registration, email verification, recovery, invitations, org switching, last-owner, role changes, session revoke, uploads, and operator support tested end-to-end?                                 |
| `inbox`        | Are review/note/status reads and writes property-scoped in the database query? Are cursor pagination, concurrency, reviewer PII, and stale caches safe?                                                |
| `integration`  | Are OAuth scope, token encryption/rotation, reconnect/revoke, Pub/Sub identity/dedupe, quota, import cursor, 30-day policy, and regional routing resolved?                                             |
| `leaderboard`  | Are snapshots isolated, deterministic, privacy-appropriate, and opt-out/disclosure decisions recorded for staff monitoring?                                                                            |
| `metric`       | Are definitions versioned, calculations reproducible, source retention permitted, materialized refresh observable, and property time zones correct?                                                    |
| `notification` | Are preferences authoritative, events/outbox/email idempotent, urgent paths monitored, bounces/suppressions handled, and message content minimized?                                                    |
| `portal`       | Are public slugs/QR/clicks non-enumerable enough, redirects allowlisted, links safe, content escaped, uploads isolated, and public caching free of tenant/private data?                                |
| `property`     | Is this the tenant's data-residency/routing anchor? Are create/update/delete/connect/disconnect operations authorized and audited? Are slug/location uniqueness constraints scoped correctly?          |
| `review`       | Is Google content retention permitted? Are review imports/dedupe/replies idempotent, policy-compliant, explicitly human-published, and fully property-scoped?                                          |
| `staff`        | Do assignments immediately affect effective permissions and session/cache freshness? Are team/portal/property relationships constrained against tenant mismatch?                                       |
| `team`         | Are membership transitions, deletion/cascade behavior, last-admin/owner rules, invitation races, and cross-property scope proven?                                                                      |

### Cross-context rules

**Beta gate.** Every context must document:

- owned data and source of truth;
- public application interface and authorization requirements;
- invariants enforced in domain code and database constraints;
- emitted/consumed event schema, version, ordering assumption, idempotency key, and failure behavior;
- retention/deletion and audit obligations;
- observability attributes and prohibited sensitive fields;
- external dependencies, timeouts, quota, retry, and degradation;
- property region/routing behavior;
- unit, repository integration, cross-tenant negative, concurrency, and journey tests.

## 16. Region routing and future AI readiness

The approved direction is property-region routing. That decision should be represented before AI work so it does not become an ad-hoc provider switch inside Phase 17.

**Beta gate — region as domain data.** Give each property a validated processing region selected by policy, contract, or customer configuration. Record when/why it was assigned and prevent silent changes after data exists.

**Beta gate — routing contract.** Define a shared routing value object and service that maps a property region to the permitted database/storage/queue/observability/email/AI endpoints. Reject unsupported routes. All jobs carry property ID and route version; consumers re-resolve policy rather than trusting a caller-supplied provider URL.

**Beta gate — data-flow enforcement.** Region choice must cover payload, provider logs/abuse monitoring, telemetry, backups, support access, and disaster recovery—not only the model endpoint. International transfer and Google policy decisions still apply to public reviews.

**Recommendation — control plane versus data plane.** Keep global, low-sensitivity configuration/identity metadata separate from property review content and derived data where practical. Use per-region data/queue/provider adapters behind stable ports. Avoid cross-region organization summaries; the stated Phase 18 product scope should be per-property reporting only.

**Beta gate before AI.** No review is sent to an AI provider until the provider is approved as a subprocessor, region policy is resolvable, input/output retention and training terms are recorded, Google permits the use, redaction/minimization is defined, quota/cost is atomic, and the call is auditable without storing raw content in telemetry.

## 17. Proposed evidence package for a go/no-go beta review

The release decision should be based on artifacts, not statements that work is “done.”

### Required evidence

- Google written response on GBP content storage, aggregation, and AI processing, plus the product's documented interpretation.
- Signed/approved beta customer terms, privacy notice(s), DPA/subprocessor list, data map, retention schedule, region/transfer decision, and DSAR/incident ownership.
- Threat model and scoped ASVS control matrix with evidence links and accepted exceptions.
- Endpoint/server-function inventory and complete authorization matrix.
- Automated cross-tenant negative test report covering all contexts and direct API/server-function calls.
- Production web and worker build/start smoke from a frozen lockfile and exact Node runtime.
- Clean-install and upgrade migration reports using the production migration command; no `db:push` in CI/deploy evidence.
- Destructive-test guard tests and proof that PR jobs cannot access production/staging secrets or networks.
- Database restore-drill report with achieved RPO/RTO and integrity checks.
- Redis/BullMQ configuration evidence, queue dashboards, redrive runbook, and a killed-worker/redelivery exercise.
- Google Pub/Sub signed-message, duplicate, out-of-order, malformed, dependency-outage, DLQ, and replay test results.
- Resend domain-authentication evidence, idempotent-send tests, signed/duplicate webhook tests, and bounce/suppression handling.
- Upload security tests for tenant ownership, oversize, forged MIME, malicious dimensions/decompression, arbitrary key, SSRF/redirect, abandoned object, and unauthorized retrieval.
- Production telemetry redaction tests, dashboards, alert routing, and synthetic availability/review-freshness checks.
- WCAG automated report plus manual keyboard/screen-reader/reflow/contrast findings for critical journeys.
- Production-like load-test report and query plans at the stated review/property scale and burst assumptions.
- Incident, rollback, disconnect/delete, token-revoke, and restore runbooks; completed tabletop/exercise notes.
- Named beta owner, support/on-call schedule, pilot property list, access roster, beta limits, and kill switches.

### Recommended staged entry

1. **Synthetic-only rehearsal:** production infrastructure, no real Google data; prove deploy, migrations, restore, queue/webhook/email/upload paths.
2. **One owned property:** a property the company is unquestionably authorized to manage; restricted operators; daily review of logs and failures.
3. **Three to ten properties:** add distinct organizations/properties/roles/regions to exercise isolation and routing; maintain explicit daily go/no-go review.
4. **Controlled internal beta:** expand only after at least two weeks without unresolved P0/P1 security, data-loss, duplicate-side-effect, or Google-policy events and after SLO measurement is trustworthy.

At every stage, a tenant-isolation failure, unauthorized Google action, unexplained data loss, inability to restore, leaked credential, or policy violation is an automatic stop and incident review.

## 18. Priority ordering for the implementation plan

This research supports the following order; detailed tickets should be produced only after the Google/legal decisions and repository audit are reconciled.

1. **P0 decisions:** Google content/AI permission; privacy/controller/processor/region model; beta promise; SLO/RPO/RTO; supported browsers/devices; pilot ownership.
2. **P0 build and data correctness:** fix production web/worker builds; single migration runner; clean/upgrade CI; test DB isolation; schema invariants; deterministic critical E2E.
3. **P0 security:** endpoint inventory; tenant matrix and negative tests; auth/session/proxy/origin/CSRF; secrets; uploads/SSRF; webhook identity/dedupe; audit events.
4. **P0 recovery and external side effects:** backups/restore; BullMQ durability/idempotency/DLQ; reply/email outboxes; kill switches and runbooks.
5. **P1 operations:** OTel/logs/metrics/traces/redaction; dashboards/alerts/synthetics; Railway readiness/pre-deploy/rollback; capacity and failure tests.
6. **P1 product quality:** accessible critical flows, error/empty/loading states, responsive/mobile behavior, performance budgets, support/admin tools, onboarding and disconnect/deletion UX.
7. **P1 supply chain:** GitHub permissions/SHA pins, CodeQL, secret scanning/push protection, dependency review, SBOM/attestation, protected deployment environment.
8. **Only then PRE17/17/18:** property-region provider routing, AI data contract, provider evaluation, quotas/cost, model quality/safety, per-property trends, and AI-specific operations.

## Source-maintenance note

Vendor policies, OAuth behavior, quotas, runtime support, privacy regulations, and provider features change. Add a quarterly owner/date review for the Google, Better Auth, TanStack, Node, Railway, Neon, Redis/BullMQ, Resend, GitHub, privacy, and AI-provider source links in this document. Google's policy explicitly places responsibility on the developer to keep current.
