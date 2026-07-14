# Beta Readiness Audit

**Date:** 2026-07-14  
**Scope:** All 16 bounded contexts, shared runtime, database, jobs, routes, UI, tests, CI, deployment, security, privacy, and operations  
**Target:** Internal-team beta using real properties; long-term capacity of 5,000 properties and 500,000 new reviews per month  
**Method:** Static code and schema review, repository-wide searches, configuration inspection, and local verification commands. The production web build is currently broken, so this is not presented as a completed browser or assistive-technology audit.

This report is a point-in-time assessment of the working tree, not a certification. The working tree contains an active inbox/goal redesign: 131 modified/deleted paths and 32 untracked paths at audit time. Existing audit documents were treated as historical input only; current code is authoritative.

## 1. Executive conclusion

The architecture has a strong foundation: explicit bounded contexts, domain/application/infrastructure layering, tenant-aware repositories, branded identifiers, tagged errors, a substantial automated-test corpus, a documented design system, and clear ADRs. The product is nevertheless **not ready to ingest or mutate real-property data yet**.

The immediate blockers are not AI-specific:

1. The production web build fails.
2. The locked dependency graph contains one critical and three high advisories, including runtime Better Auth and Kysely findings.
3. Vitest inherits `DATABASE_URL` from the normal `.env`; the current local configuration points at a remote managed database, and repository tests execute cleanup SQL without a test-database identity guard.
4. Production schema creation is not reproducible through one journaled migration path; CI uses `db:push` and sidecar SQL remains outside the migration journal.
5. Cross-context events are in-process and can be lost after a business transaction commits.
6. Property deletion is an immediate irreversible hard delete, while disconnect, source-content expiry, property deletion, and organization deletion are not one durable lifecycle.
7. Deployment does not codify separate web/worker roles, pre-deploy migration, readiness, backups, restoration, or observability.
8. Public guest-session and upload boundaries are unsafe if the portal surface is enabled for beta.

The right route to beta is a smaller, controlled product. Enable only the real-property critical path—identity, property, Google integration, review ingestion, inbox, human-approved reply, staff access, limited dashboard, and in-app notifications. Keep goals, badges, leaderboards, custom roles, public portal/guest writes, and external notification email dark until each passes its named gate.

## 2. Verification baseline

| Check                                 | Result on 2026-07-14                                                                                       | Assessment                                                                                                                                                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                      | Pass                                                                                                       | Keep blocking.                                                                                                                                                                                                                                             |
| `pnpm lint`                           | Pass                                                                                                       | Good baseline, but current boundary rules still allow any application file to import another context's application layer rather than only `public-api.ts`.                                                                                                 |
| `pnpm build`                          | Fail                                                                                                       | Vite 8/Rolldown requires function-form `manualChunks`; a route test is also being discovered as a route. No beta deploy is possible.                                                                                                                       |
| `pnpm build:worker`                   | Pass                                                                                                       | Add as a blocking CI gate and deploy as a distinct service.                                                                                                                                                                                                |
| `pnpm test`                           | Prior completed baseline: 2,370 pass, 5 fail. Targeted rerun reconfirmed the five recurring-goal failures. | Goal metric/scope contract drift prevents recurrence instances from being built. The later full rerun was stopped after the unsafe remote test-DB default was confirmed.                                                                                   |
| `pnpm format:check`                   | Fail on 106 files                                                                                          | Define owned/generated scopes, then make it blocking.                                                                                                                                                                                                      |
| `pnpm audit --prod --audit-level low` | 9 advisories: 1 critical, 3 high, 3 moderate, 2 low                                                        | Patch before beta. The Kysely override pins `0.28.16` below the fixed `0.28.17`; Better Auth resolves to `1.6.12` below fixed `1.6.13`; Vite and Vitest also have patch releases named by the advisories. Re-run tests and review behavior after upgrades. |
| CI E2E                                | `continue-on-error`                                                                                        | Critical workflows have no release protection.                                                                                                                                                                                                             |
| Storybook build                       | `continue-on-error`                                                                                        | Component build is not a release gate.                                                                                                                                                                                                                     |
| Deployment config                     | One generic Railway replica                                                                                | Web/worker/migration topology and health are not represented in repository configuration.                                                                                                                                                                  |

### Test database safety finding

`vitest.config.ts` calls `dotenvConfig()` and then prefers `process.env.DATABASE_URL`. Repository suites create real pools and execute `DELETE` statements. There is no check that the host is local, the database is disposable, or a database marker identifies it as a test database. The active `.env` selected a remote non-local database during this audit.

Before another full repository run:

- introduce a separate required `TEST_DATABASE_URL` for PostgreSQL integration tests;
- refuse the connection unless `NODE_ENV=test` and a purpose-built marker/table or ephemeral lease proves the database is disposable;
- use a per-run local container/database/schema in developer and CI workflows;
- prohibit production/staging hostnames and ordinary `DATABASE_URL` fallback;
- split pure unit tests from PostgreSQL and Redis/BullMQ integration projects.

## 3. Beta posture by context

| Context          | Beta posture                                         | Principal findings                                                                                                                                                                                                                                                                                                                                                           | Required gate                                                                                                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **activity**     | Enable after durable delivery                        | Useful product timeline, but it copies actor metadata and arbitrary JSON, has no retention policy, and is not a security audit. Nullable event IDs weaken deduplication.                                                                                                                                                                                                     | Outbox delivery, validated event payloads, retention, PII-safe rendering, and an explicit decision separating product activity from immutable security audit.                                                                                                                   |
| **badge**        | Dark                                                 | Large repository, JSON criteria, recognition schedule, handler fan-out, role-based scope branches, and limited value for the core property workflow.                                                                                                                                                                                                                         | Independent correctness/load tests, dynamic-authorization migration, owned schedule definition, idempotent projection, and product acceptance.                                                                                                                                  |
| **dashboard**    | Limited beta                                         | Raw review/metric queries remain; cache is unused; three materialized views are refreshed but never read. Review-derived aggregation remains subject to the Google policy disposition.                                                                                                                                                                                       | Bounded property-scoped reads, query budgets, permitted-source capabilities, incremental rollups for first-party metrics, and no illegal Google-content aggregate.                                                                                                              |
| **goal**         | Dark                                                 | Five recurring-job tests fail because `portal.scan` is no longer valid for property scope. Recurrence/calendar logic and UI helpers are broad, and jobs run even if navigation is hidden.                                                                                                                                                                                    | Green deterministic calendar/recurrence suite, context-owned schedules, metric-contract tests, idempotent instances, and server-side feature disablement.                                                                                                                       |
| **guest**        | Dark unless specifically piloted                     | Client JavaScript creates `guest_session`; the server trusts arbitrary unvalidated cookies; cookie rotation bypasses session-keyed throttling; raw forwarded IP is trusted; Redis failures fail open. Privacy copy claims no personal data is collected despite online identifiers/IP hashes and stored feedback.                                                            | Server-set signed opaque cookie, trusted-proxy address module, combined IP/session/device abuse policy, endpoint-specific limits, bot controls, accurate privacy notice/retention, and public-surface load/security tests.                                                      |
| **identity**     | Required                                             | Better Auth is structurally isolated, but public registration/org creation remains open, verification is optional and absent from env validation, custom-role capability is only partially adopted, raw role hierarchy remains in some paths, and permission types are hand-maintained. Session cache keys include raw tokens.                                               | Patched auth dependencies; invite-only beta; verified email; admin MFA/passkey decision; one `AuthorizationPolicy` returning action and data scope; built-in roles only until custom-role closure; user/member/org lifecycle; hashed bounded cache; rate-limit/proxy hardening. |
| **inbox**        | Required                                             | Core workflow and active redesign. Projection correctness depends on lossy in-process events; source/property relationships and copied review fields need lifecycle enforcement. Large repository mixes read and command concerns.                                                                                                                                           | PRE17 durable projection and source lifecycle, cursor queries, transactional status/escalation invariants, read-model/command-store seam, migration compatibility, and critical E2E.                                                                                            |
| **integration**  | Required                                             | OAuth state and token encryption are sound foundations. Missing pieces include versioned key rotation, persistent webhook receipts, reliable subscription health, durable import workflow, explicit Google-account ownership invariant, bounded API behavior, and complete disconnect teardown. `messageId` may become `unknown`.                                            | Versioned ciphertext, verified scopes/accounts, durable import and notification workflows, persistent dedupe, connection health/reconnect UI, quota/error classification, and source teardown proof.                                                                            |
| **leaderboard**  | Dark                                                 | Only two tests, a large repository, polymorphic targets, snapshot tenancy ambiguity, and background reconciliation independent of visible UI.                                                                                                                                                                                                                                | Schema tenancy constraints, idempotent snapshot projection, authorization, scale tests, schedule ownership, and product acceptance.                                                                                                                                             |
| **metric**       | Enable only for permitted first-party portal metrics | Readings lack source-event idempotency. Materialized views cost work but serve no reads. Goal contract drift proves metric keys/scopes are not protected as a cross-context contract.                                                                                                                                                                                        | Event IDs/unique receipts, property-local daily rollups, contract tests consumed by goal/badge/dashboard, removal of dead refresh jobs, and source-policy separation.                                                                                                           |
| **notification** | In-app only initially                                | Strong state-machine intent, but emails have no provider message ID, idempotency key, delivery/bounce/complaint webhook, allowlist, or verified delivery runbook. Send-then-mark can duplicate after a crash. Content is copied into notification rows.                                                                                                                      | Durable event creation, beta recipient allowlist, verified sending domain, provider idempotency/delivery feedback, suppression list, retention, unsubscribe/preference tests, and email off-switch.                                                                             |
| **portal**       | Dark unless specifically piloted                     | Good domain separation and HTTPS link checks in create/update. Upload security is incomplete: declared size is trusted, presigned PUT does not enforce it, finalize accepts a caller-supplied key without proving its scope, and image processing downloads a public URL into memory with no byte/pixel/time bounds. The upload drop zone is a clickable non-semantic `div`. | Storage-key capability record, private object reads, magic-byte/MIME/size/pixel validation, isolated bounded image processing, deletion, URL/theme contrast validation, public-page accessibility, and abuse/privacy gates.                                                     |
| **property**     | Required                                             | The use case/file still named soft-delete performs a hard cascade, and the UI exposes a one-click irreversible confirmation. Country/region provenance and lifecycle are incomplete.                                                                                                                                                                                         | Archive-first lifecycle, typed-name confirmation for eventual purge, durable teardown status, Google disconnect behavior, immutable processing region after ingestion, validated IANA zone/country, and recovery proof.                                                         |
| **review**       | Required                                             | Reply transitions use a valuable conditional status update, but persistence → queue/event is not atomic. Webhook sync, pagination, source timestamps, bounded reconciliation, and teardown require PRE17. Publishing is an external saga and must recover from crash/retry.                                                                                                  | PRE17 ingestion/lifecycle, targeted webhook fetch, resumable reconciliation, Google-compliant pagination, content lineage/expiry, idempotent publish workflow, manual approval, status/failure UI, and reply E2E.                                                               |
| **staff**        | Required for multi-user beta                         | Membership and property checks exist, but replacement of portal assignments is multiple writes/events without one transaction. Four partial uniqueness partitions do not define the higher-level meaning of direct/team/portal access. Some admin decisions still branch on static role.                                                                                     | Canonical assignment model, atomic replace command, tenant/resource invariants, dynamic-policy-compatible acting-user rules, invitation-assignment recovery, and cross-tenant tests.                                                                                            |
| **team**         | Optional/dark                                        | Straightforward domain, but lead membership has no database FK and soft-deleted teams rely on every read to exclude them. Staff assignment semantics make team deletion/reassignment operationally complex.                                                                                                                                                                  | Decide whether direct staff assignment is enough for beta; otherwise enforce lead membership, transactionally reassign/remove members, validate active-team reads, and cover member removal.                                                                                    |

## 4. Cross-cutting findings

### P0 — Blocks any real-property beta

#### BETA-P0-01 — Isolate and restore the engineering baseline

Evidence:

- production web build fails in `vite.config.ts`;
- goal recurring tests fail from metric/scope drift;
- format is not reproducible;
- CI has no web/worker build gate and allows E2E/Storybook failure;
- tests can inherit a remote normal database;
- the working tree is too broad to identify a safe deployable revision.

Action: freeze the current redesign into reviewed commits, create an immutable beta baseline tag, add disposable test environments, repair all gates, and require clean checkout reproduction.

#### BETA-P0-02 — Patch the dependency and supply-chain baseline

The current audit is a release blocker. Upgrade the locked direct/transitive graph in controlled commits, remove the vulnerable Kysely override, re-run Better Auth schema/behavior tests, and add automated dependency review, update PRs, secret scanning, static analysis, and SBOM/provenance generation. Do not treat a dev-server-only advisory as equivalent to a runtime finding, but do not waive it without a recorded reachability decision.

#### BETA-P0-03 — Make committed work durable and replay-safe

`shared/events/event-bus.ts` acknowledges that events are in-process. Business state can commit while inbox, metrics, activity, notifications, or scheduled work is lost. `Promise.allSettled` also hides handler failures from the caller.

Action: make PRE17A's PostgreSQL transactional outbox, relay, database consumer receipts, context-owned command stores, and idempotent external effects part of beta—not only an AI prerequisite.

#### BETA-P0-04 — Establish one schema and deployment authority

CI uses `db:push`; auth migrations, Drizzle migrations, sidecar SQL, materialized-view SQL, and DAC triggers have separate procedures. Railway configuration does not specify a pre-deploy migration or separate worker process.

Action: one versioned forward-migration path, clean/upgrade tests, advisory lock, schema verification, pre-deploy execution, expand/backfill/contract changes, and rollback/roll-forward runbooks.

#### BETA-P0-05 — Replace destructive deletion with durable lifecycle

`soft-delete-property.ts` now calls `hardDelete`, while names and historical docs still imply soft deletion. This can cascade real reviews, replies, inbox items, teams, and assignments immediately. Disconnect and organization deletion are not equivalent durable workflows.

Action: archive first, stop sync/publish, show lifecycle progress, purge only after an explicit grace/approval policy, record content-free deletion evidence, and test retry/recovery for property, Google connection, user, and organization teardown.

#### BETA-P0-06 — Create a production safety envelope

Before the first real property, require:

- invite-only beta organizations and property allowlist;
- verified email and an admin strong-auth decision;
- safe security headers/CSP, trusted proxy configuration, origin/CSRF verification, request/body/time limits, and production error redaction;
- secrets/key rotation and separate environment accounts;
- encrypted backups/PITR plus a successful restoration drill;
- liveness/readiness, worker heartbeats, error monitoring, queue/sync/deletion alerts, and incident runbooks;
- privacy notice, terms/internal beta agreement, data map, retention schedule, subprocessors, and a data-subject/customer request procedure;
- written Google policy disposition before Google-derived AI or aggregate features.

### P1 — Required for the selected beta surfaces

#### BETA-P1-01 — Deepen authorization

The canonical permission statement and hand-written `Permission` union can drift. Most code uses `canForContext`, but badge, invitation hierarchy, staff acting-user logic, and goal route capability flags still rely on static roles. Activity uses `organization.update` as an org-wide proxy rather than the permission's declared scope.

Create one deep `AuthorizationPolicy` that owns permission existence, action decision, property data scope, target-resource membership, last-owner rules, and client capability serialization. Outside identity/auth, code should not branch on roles. Keep custom roles disabled in beta until a repository-wide guard proves no role-based decision remains.

#### BETA-P1-02 — Harden external workflows

Property import, invitation acceptance, email delivery, notification subscription, image processing, review sync, and reply publication are multi-step workflows. Several catch and continue, making failure look like success; others can repeat an external side effect after a crash.

Represent each as a durable state machine with an idempotency key, current step, attempt/error class, retry schedule, operator action, and terminal state. External adapters must expose typed retryability and safe provider references without raw bodies/tokens.

#### BETA-P1-03 — Remove generic query retry

`shared/db/pool.ts` monkey-patches `pool.query()` and retries arbitrary promise-form queries on transient network errors. Retrying an unknown write outside an idempotent operation boundary can duplicate effects or obscure transaction outcome.

Retry connection acquisition and explicitly safe reads where justified. Retry transactions only for recognized serialization/deadlock cases at an idempotent command boundary. Add statement, lock, idle-transaction, and acquisition timeouts by workload class. Readiness must await database initialization instead of fire-and-forget warmup.

#### BETA-P1-04 — Harden the public edge or keep it dark

For guest routes:

- remove the client-created session cookie;
- issue a signed/opaque server cookie with `HttpOnly`, `Secure` in production, narrow `Path`, and validated lifetime/format;
- derive client address only from a configured trusted proxy chain;
- key abuse decisions on multiple signals so cookie rotation is not a reset;
- do not fail open for authentication/public writes without a bounded fallback;
- use endpoint-specific policies and return standard rate-limit headers;
- make the notice accurate: an essential cookie notice is not consent, and online identifiers can be personal data.

#### BETA-P1-05 — Harden storage and uploads or keep portals dark

Use a server-created upload capability row that binds organization, portal, exact key, expected size/type, expiry, and status. Prefer presigned POST conditions or verify object metadata before acceptance. The worker should read the private object by key, stream/bound bytes, verify file signature, limit decoded pixels/frames, apply a timeout/resource limit, write safe variants, and delete/quarantine originals. Never fetch a caller-influenced public URL.

#### BETA-P1-06 — Make outbound email safe

Centralize every auth and notification email behind one `OutboundEmail` module with environment recipient allowlisting, provider idempotency keys, provider message IDs, signed/deduplicated delivery webhooks, bounce/complaint suppression, domain authentication, unsubscribe/preference rules, content classification, and a kill switch. During early beta, allow only internal-team domains/addresses.

#### BETA-P1-07 — Bound high-cardinality UI/data paths

The authenticated root loads all accessible properties and organizations for every page. At 5,000 properties this becomes a latency, memory, hydration, and disclosure problem. Replace global property lists with a compact active-property summary plus server-search/cursor selection. Apply the same review to members, assignments, imports, inbox filters, and dashboard responses.

### P2 — Beta quality and maintainability

- Break the 535-line composition root and 260-line worker into context manifests and one job runtime; do not expose a flattened bag of every repository/use case.
- Enforce cross-context application imports through `public-api.ts` only and add contract tests/versioning for metric keys, events, and DTOs.
- Split command stores from read models in large repositories such as inbox, goal, badge, and reply workflows. Split where it deepens a seam, not merely because a file is long.
- Remove the unused `audit_logs` schema or implement a deliberately immutable security-audit context. It currently duplicates the implemented activity concept without writers.
- Add database checks for finite statuses/types, tenant-consistency constraints for high-risk relationships, and explicit lineage for polymorphic references.
- Remove stale claims from README, context docs, security docs, and comments. `contexts/CONTEXT.md` still recommends static `can(ctx.role, ...)`; the property deletion name/docs no longer match behavior.
- Self-host/subset fonts or provide a dependable privacy/performance-safe font strategy; `styles.css` currently blocks on two external font services.
- Add a production-safe generic error boundary with a correlation ID. Do not render arbitrary `error.message` to end users.

## 5. UI quality audit

Scores use 0 = poor, 4 = excellent. They measure code evidence available before the web build is repaired.

| Dimension     | Score | Evidence                                                                                                                                                                                                                                                                                                                    |
| ------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accessibility |   2/4 | Good use of Radix/shadcn primitives, labels, `aria-live`, alerts, and Storybook a11y tooling. Blocking gaps include a clickable non-keyboard upload `div`, no reduced-motion handling, custom portal colors without contrast validation, limited live error semantics, and no blocking end-to-end keyboard/assistive audit. |
| Performance   |   1/4 | Production build fails; all properties load in the root; raw dashboard queries remain; dead materialized views refresh; bundle budgets are absent; external font imports block; current test integration is extremely slow against remote DB.                                                                               |
| Theming       |   3/4 | `DESIGN.md` and `styles.css` provide strong semantic light/dark tokens. Guest/public and recognition components bypass them with raw gray/red/green/amber classes and user-selectable colors need contrast enforcement.                                                                                                     |
| Responsive    |   2/4 | The app shell and inbox have deliberate mobile layouts. Only desktop Chromium is configured in Playwright, several controls use fixed widths, resizable-panel behavior is unverified for keyboard/touch, and no tablet/mobile release matrix exists.                                                                        |
| Anti-patterns |   2/4 | Component primitives and stories are good. Global composition, duplicated mobile hooks, inline style injection, raw semantic colors, magic timers/polling, overly broad repositories, and hidden schedules for disabled features create systemic drift.                                                                     |

### UI P1/P2 actions

1. After the web build is green, audit the critical journey at 320, 375, 768, 1024, and 1440 CSS pixels; test 200%/400% zoom, keyboard only, screen reader smoke, high contrast, reduced motion, and light/dark themes.
2. Add Playwright projects for a representative mobile device and desktop Firefox/WebKit where the supported-browser decision requires them. Keep a small critical cross-browser suite rather than multiplying every test.
3. Make Storybook build and axe violations blocking for owned components; add interaction stories for empty, loading, failure, permission-denied, long translated text, and destructive states.
4. Replace clickable containers with semantic controls; make resize handles discoverable and operable; preserve focus when inbox list/detail routes change.
5. Validate portal theme contrast and protect text/background/accent combinations. Never convey priority/status only by color.
6. Add `prefers-reduced-motion` behavior for animated primitives and progress effects.
7. Measure Core Web Vitals and route bundles after the build fix; set budgets before optimizing. Lazy-load charts, DnD, color picker, and other heavy route-only modules when bundle evidence supports it.
8. Run `polish` only after accessibility, responsive, and performance gates are green; visual refinement is the final pass, not a blocker substitute.

## 6. Data, privacy, and policy assessment

### Data inventory that must be explicit

- Google reviewer name, photo URL, review text, rating, language, publication/update/fetch/expiry timestamps, Google identifiers, and replies;
- app user name/email/avatar/session/invitation/roles and property assignments;
- guest session identifier, daily IP hash, scan/rating/feedback text, source and timestamps;
- activity and notification copies of actor/resource/content;
- OAuth tokens, scopes, Google account/email, provider errors, and delivery metadata;
- telemetry identifiers, logs, traces, backups, object storage, and support access.

For every class record purpose, lawful/business basis, source, region, processors, access roles, retention, backup expiry, export/deletion behavior, and whether derived data follows source deletion. Minimize copies: events and jobs should carry IDs, while consumers reload authorized current state.

### Google-specific boundary

No sentiment, priority, generated-reply prompt, few-shot example, historical analysis, theme/trend report, or review aggregate should be enabled for Google content until the written Google response is converted into ADR 0031 and a release capability. “No training,” short provider retention, or regional processing does not itself grant Google-content manipulation/aggregation rights.

### Internal-beta legal/operational minimum

Before real property data enters the system, publish or execute an internal beta agreement and privacy notice that accurately describes Google access, storage, subprocessors, security contact, retention/deletion, and beta limitations. Establish a request workflow for disconnect, property purge, organization closure, data export where applicable, and incidents. Have counsel/privacy ownership review US state and European obligations before inviting external testers.

## 7. Architecture target

The highest-leverage deep modules are:

- `AuthorizationPolicy`: action + property scope + resource membership + owner invariants;
- `ClientRequestIdentity`: trusted proxy address, request ID, origin, session/device signals;
- `ContextCommandStore`: context-owned transaction + outbox append;
- `JobRuntime`: queue topology, job/schedule manifests, retries, dedupe, health, shutdown, telemetry;
- `ExternalWorkflow`: durable step state/idempotency for import, sync, publish, email, subscription, and deletion;
- `SourceContentLifecycle`: lineage, capability, expiry, disconnect, property/org purge;
- `PropertyProcessingProfile`: country, IANA zone, processing region, routing policy version;
- `SafeUpload`: upload capability, object verification, processing, lifecycle;
- `OutboundEmail`: allowlist, idempotency, delivery feedback, suppression, preferences;
- `BetaCapabilities`: server-enforced organization/property allowlist and feature/job kill switches;
- `TestEnvironmentLease`: explicit disposable PostgreSQL/Redis ownership and destructive-operation guard.

These interfaces should hide complexity. Avoid adding pass-through services or a generic repository/unit-of-work framework that leaks Drizzle transactions across contexts.

## 8. Recommended disposition

Proceed with the beta-readiness program in [the beta master plan](beta-readiness-master-plan.md), absorbing PRE17A/B/C wherever the same reliability, review lifecycle, regional routing, observability, or scale work is already planned. Do not start Phase 17/18 implementation until the beta core path is reliable and PRE17's explicit AI/policy gates are satisfied.
