# Shared — Context

**Audience:** AI agents and developers working in `src/shared/`.

## Folder structure

Every non-empty first-level area is declared here exactly once. The owner is
responsible for keeping the area infrastructure-only or genuinely
cross-context; this table does not transfer product meaning away from an owning
bounded context. The former shared `projections/` catalogue is intentionally
absent: each retained projection declares freshness, replay, and repair in its
owning context rather than recreating a global coordination bucket.

<!-- shared-first-level-ownership:start -->

| Area                      | Purpose                                                                                                                         | Owner and placement rule                                                                                                                                        | Permitted dependencies                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `architecture`            | Executable dependency, reachability, current-authority, and cross-context invariant checks.                                     | Architecture Governance owns this area; keep only enforcement and narrow boundary descriptors here, never product workflows.                                    | `architecture`                                                                                                          |
| `auth`                    | Shared authentication, session and tenant resolution, permissions, capability policy, and controlled execution decisions.       | Platform Security owns the enforcement kernel while Identity owns user and Organization facts; context-specific authorization rules stay with their context.    | `auth`, `cache`, `config`, `db`, `domain`, `email`, `google-provider-control`, `governance`, `observability`, `routing` |
| `bqc`                     | Machine-readable beta quality and evidence-status schemas retained for acceptance tooling.                                      | Release Governance owns this vocabulary; it may describe evidence but must never become runtime product state.                                                  | `bqc`                                                                                                                   |
| `cache`                   | Generic cache ports plus Cache Redis clients and implementations.                                                               | Runtime Platform owns connection and cache mechanics; feature keys, freshness meaning, and invalidation policy remain with their reader or owning context.      | `cache`, `config`, `observability`                                                                                      |
| `config`                  | Parsed environment contracts, production secret checks, boot guards, and local-stack or release configuration facts.            | Runtime and Release Engineering own parsing at composition boundaries; application use cases must not introduce ambient environment reads here.                 | `auth`, `config`, `domain`                                                                                              |
| `db`                      | Drizzle connection, pool, schema and migration authority, tenant-safe query primitives, and deployment migration verification.  | Data Platform owns database mechanics and schema authority; bounded contexts continue to own the business meaning and lifecycle of their records.               | `auth`, `config`, `db`, `domain`, `governance`, `observability`, `ops`, `outbox`, `release`                             |
| `domain`                  | Pure cross-context value types and primitives such as branded identifiers, clocks, calendars, roles, and safe encodings.        | Architecture Governance owns admission to this area; a type used by only one context belongs in that context and no I/O or framework code is allowed.           | `domain`                                                                                                                |
| `email`                   | Reusable email rendering, layout, URL, sender-alignment, and transport-selection primitives.                                    | Communications Platform owns rendering and transport mechanics; each context owns message meaning, recipients, policy, and delivery timing.                     | `email`                                                                                                                 |
| `events`                  | Event bus, master event union, schema registry, and delivery-gate infrastructure.                                               | Event Platform owns envelopes and dispatch mechanics; each bounded context owns its event types, constructors, payload meaning, and producer transaction.       | `events`, `observability`                                                                                               |
| `generated`               | Checked-in deterministic tables generated from pinned external or governance inputs.                                            | The named generator and its owning policy area own each artifact; generated files are never edited by hand and require digest or parity evidence.               | `generated`                                                                                                             |
| `google-provider-control` | Google route catalogue, request binding, quota and concurrency coordination, admission grants, and credential-broker contracts. | Integration owns provider semantics and Platform Security owns transport fences; Review or merchant workflows must enter through named public ports.            | `domain`, `google-provider-control`, `security`                                                                         |
| `governance`              | Executable entry-point, event-job, protected-field, capability-fate, standards, and data-authority catalogues.                  | Architecture Governance owns these machine-checked authorities; prose may explain them but cannot create a competing runtime truth.                             | `auth`, `db`, `domain`, `governance`                                                                                    |
| `health`                  | Readiness probes, operational snapshots, dependency health, queue depth, worker heartbeat, and migration visibility.            | Reliability Engineering owns health semantics and alert evidence; contexts contribute bounded probes rather than placing business repair workflows here.        | `auth`, `cache`, `config`, `db`, `domain`, `health`, `jobs`, `observability`, `outbox`                                  |
| `hooks`                   | Browser-side permission and capability hooks shared across feature surfaces.                                                    | Frontend Platform owns only cross-feature access hooks here; domain-specific data and interaction hooks remain beside their feature.                            | `auth`, `domain`, `hooks`                                                                                               |
| `http`                    | Small protocol-level HTTP status and response primitives shared by delivery boundaries.                                         | Web Platform owns this area; routing, authorization decisions, and business error mapping stay in their server or context boundary.                             | `http`                                                                                                                  |
| `jobs`                    | BullMQ queue, registry, scheduling, retry, quarantine, readiness, Redis topology, worker controls, and shared system jobs.      | Job Runtime owns execution mechanics and catalogue enforcement; context business handlers and their facts remain context-owned.                                 | `auth`, `config`, `db`, `domain`, `events`, `governance`, `health`, `jobs`, `observability`, `outbox`, `routing`        |
| `lifecycle`               | Process-level startup and graceful resource-shutdown coordination.                                                              | Runtime Platform owns process lifecycle only; Property, Review, Portal, and other domain lifecycles must not be implemented here.                               | `lifecycle`                                                                                                             |
| `observability`           | Structured logging, tracing, metrics schemas, redaction, telemetry, alerts, and web or worker preload wiring.                   | Reliability and Platform Security jointly own this area; signals stay content-minimized and cannot trigger product mutations directly.                          | `auth`, `config`, `db`, `domain`, `health`, `jobs`, `observability`, `outbox`                                           |
| `ops`                     | Operator-command, recovery-fence, restore-verification, and bounded compatibility-lifecycle contracts.                          | Operations owns safe orchestration and evidence; business mutations execute through an owning context port and an authorized audited command.                   | `auth`, `config`, `db`, `domain`, `ops`, `outbox`                                                                       |
| `outbox`                  | Durable event envelopes, atomic commit helpers, relay, receipts, consumer registry, shadow comparison, and cutover gates.       | Event Platform owns delivery guarantees; contexts own source transactions and event meaning, and consumers cannot treat outbox payloads as content caches.      | `db`, `domain`, `events`, `governance`, `jobs`, `observability`, `outbox`                                               |
| `provider-ephemeral`      | Short-lived provider references, authorization leases, invalidation, isolated storage, and runtime verification.                | Platform Security owns this content-minimizing boundary; durable provider content and business state are forbidden.                                             | `auth`, `domain`, `provider-ephemeral`, `security`                                                                      |
| `queries`                 | Cross-feature TanStack Query key namespaces and tenant-cache transition helpers.                                                | Frontend Platform owns cache namespace mechanics; server reads, DTOs, and feature-specific state remain in their owning contexts or components.                 | `queries`                                                                                                               |
| `rate-limit`              | Generic distributed request-rate limiting middleware and failure posture.                                                       | Platform Security owns the limiter mechanism; every route or context must explicitly own its bucket, threshold, subject, and fail-open or fail-closed decision. | `observability`, `rate-limit`                                                                                           |
| `release`                 | Promotion manifests, Railway deployment profiles, cutover evidence, image isolation, and schema-bootstrap audit contracts.      | Release Engineering owns immutable release evidence and validation; execution remains in reviewed release scripts rather than application runtime.              | `auth`, `db`, `domain`, `governance`, `release`                                                                         |
| `routing`                 | Data Cell execution fences, processing routes, credential-home routing, and dormant broker runtime contracts.                   | Data Cell Platform owns routing policy enforcement; contexts provide explicit tenant and Property scope and no caller may add an implicit fallback.             | `domain`, `routing`, `security`                                                                                         |
| `security`                | Generic request guards, client-IP handling, security headers, safe error display, redaction, and versioned keyring primitives.  | Platform Security owns reusable controls; provider-specific and domain-specific policy remains in its named owner area.                                         | `config`, `domain`, `observability`, `security`                                                                         |
| `testing`                 | Test fakes, fixtures, environment leases, local-stack controls, evidence capture, and integration harnesses.                    | Test Platform owns this test-only area; production modules must never import it and fixtures cannot become runtime authorities.                                 | `auth`, `bqc`, `config`, `db`, `domain`, `events`, `health`, `jobs`, `observability`, `testing`                         |

<!-- shared-first-level-ownership:end -->

## Root production-file categories

The shared root is not a general placement target. It currently contains a
transitional cross-context contract kernel whose exact and prefix categories
are listed below. The `ai-*` family includes its checked-in vectors and
manifests. Some files are browser-safe while others deliberately use Node
cryptography or native language tooling; the existing browser-reachability and
gateway-source checks remain mandatory, and this table does not make the two
runtimes interchangeable. A new root file must fit exactly one category or the
architecture test fails. New context-specific behavior belongs behind that
context's public application interface instead.

<!-- shared-root-category-ownership:start -->

| File pattern                         | Purpose                                                                                                                                                          | Owner and placement rule                                                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-*`                               | Versioned AI source, redaction, leakage, language, template, output, transport, provenance, cost, runtime, and deployment contracts plus their pinned artifacts. | AI owns semantic meaning and Platform Security owns privileged transport enforcement; new workflow orchestration belongs in the AI context, not this root kernel. |
| `beta-feedback-*`                    | Shared request schema between the beta-feedback interface and its authenticated delivery boundary.                                                               | Identity owns intake and delivery while Product UI owns presentation; this category is not a general-purpose feedback domain.                                     |
| `canonical-json.ts`                  | Strict RFC 8785 canonical JSON used where multiple contexts or signed contracts require byte-stable evidence.                                                    | Platform Security owns conformance and compatibility; callers own the meaning of the value being canonicalized.                                                   |
| `closed-json-contract.ts`            | Bounded immutable plain-JSON validation used by signed or digest-pinned contract construction.                                                                   | Platform Security owns the structural control; domain fields and acceptance rules stay with the consuming contract owner.                                         |
| `ed25519-key-material.ts`            | Node-only validation and decoding of Ed25519 public-key material used during privileged service composition.                                                     | Platform Security owns key parsing and runtime separation; this file must not store private material or enter browser graphs.                                     |
| `google-performance-*`               | Integration-owned live Google performance report vocabulary shared with Dashboard and product presentation.                                                      | Integration owns provider facts and authorization leases; Dashboard is a read-only consumer and cannot add persistence or cache authority here.                   |
| `google-review-*`                    | Provider-edge normalization of Google review wire representations before Review receives canonical source content.                                               | Integration owns the Google wire shape and Review owns review meaning; only deterministic source normalization belongs in this category.                          |
| `merchant-ai-*`                      | Versioned merchant AI notice, consent-facing capability disclosure, digest, and canonicalization compatibility contract.                                         | Identity owns authorization evidence and AI owns capability meaning; changes require coordinated governance evidence rather than an in-place wording edit.        |
| `masked-layout-snapshot.ts`          | Closed geometry-only diagnostic snapshot normalization and server-side wireframe rendering for explicitly consented Bug feedback.                                | Identity owns the feedback attachment contract and Platform Security owns content exclusion; this file must never accept text, values, pixels, URLs, or media.    |
| `openai-*`                           | Exact OpenAI request-output vocabulary shared by the AI context, trusted UI consumers, and the egress gateway.                                                   | AI owns the semantic schema and the gateway owns wire enforcement; provider-specific behavior may not spread outside this named category.                         |
| `reply-language-*`                   | Browser-safe product language catalogue shared by Property, Review, Inbox, UI, and the governed AI language profile.                                             | AI owns the versioned language policy while Frontend Platform protects browser reachability; native detection stays in the server-only AI family.                 |
| `responsible-manager-eligibility.ts` | Cross-context eligibility decision for selecting responsible managers without granting access or creating assignments.                                           | Staff owns the people-policy vocabulary while Portal and Property own their assignment writes; this helper must never become an authorization grant.              |
| `review-provider-*`                  | Opaque provider-subject binding and vectors shared across Review, Integration, webhook delivery, and provider adapters.                                          | Review owns provider-subject identity and Platform Security owns its content-free binding; raw provider or review content is forbidden.                           |

<!-- shared-root-category-ownership:end -->

## What goes here

Shared code is **used by 2+ modules** across the codebase. If only one context uses it, it belongs in that context. Wait for the second importer before extracting to shared.

## Auth (`shared/auth/`)

- **`auth.ts`** — better-auth server config with organization plugin and access control statement. Raw invitation/member lifecycle hooks fail closed before mutation; app-owned Identity commands receive their lifecycle collaborators through the container, and this shared module owns no mutable lifecycle callback.
- **`auth-client.ts`** — better-auth client instance
- **`middleware.ts`** — `resolveTenantContext(headers)` resolves org from session, returns `AuthContext`. Thin delegate to `tenant-resolver.ts`; also `requireAuth`, `getUserFromHeaders`.
- **`tenant-resolver.ts`** — TenantResolver: the staged pipeline behind `resolveTenantContext` — session decode, per-request ALS memo, version-keyed in-memory cache (60s TTL; `permission_version` check is the primary freshness guard per auth-caching-improvements plan), built-in-vs-custom role strategy. Owns the pure freshness decision table (`decideTenantCacheAction` / `versionedEntryIsFresh`). See docs/auth-caching-improvements-2026-07-12.md.
- **`auth-errors.ts`** — tagged `AuthError` taxonomy + HTTP status mapping shared by middleware and the tenant resolver
- **`permissions.ts`** — `createAccessControl(statement)` defining the universe of `resource.action` permissions
- **`headers.ts`** — `headersFromContext()` (async). Builds a `Headers` object from the current TanStack Start request context. Uses **dynamic import** for `@tanstack/react-start/server` because this module is reachable from client code via `composition.ts` — a static import would pull server-only modules into the client bundle. Returns empty headers when called outside server context (e.g., BullMQ worker). All 47 server functions that call this must `await` it.
- **`server-errors.ts`** — `throwContextError` (logs before throwing), `catchUntagged` for wrapping non-domain errors
- **`emails.ts`** — email sending via Resend
- **`pubsub-jwt.verifier.ts`** — Google Pub/Sub JWT verification for GBP webhook authentication
- **`auth-cli.ts`** — CLI auth utilities for seeding/scripting

## Domain types (`shared/domain/`)

- **`ids.ts`** — branded ID types (`OrganizationId`, `PropertyId`, `PortalId`, etc.) and constructors
- **`roles.ts`** — `Role` type (`'AccountAdmin' | 'PropertyManager' | 'Staff'`), `toDomainRole()`, `hasRole()` hierarchy check
- **`permissions.ts`** — `Permission` type, `can(role, permission)` sync check. Use in server functions and route guards.
- **`auth-context.ts`** — `AuthContext` type (`{ userId, organizationId, role }`)
- **`errors.ts`** — base error types
- **`result.ts`** — neverthrow `Result` re-exports
- **`brand.ts`** — branded type helpers for nominal typing
- **`timezones.ts`** — timezone list and utilities
- **`property-calendar.ts`** — deterministic IANA wall-clock resolution and Property-local day shifting shared by Dashboard windows and Goal recurrence. DST folds choose the earlier instant; gaps advance to the first representable local minute.
- **`slug.ts`** — slug validation and normalization utilities

## Observability (`shared/observability/`)

- **`logger.ts`** — pino logger via `getLogger()`. Use everywhere instead of `console.*`. Production emits structured JSON. Development resolves the optional, dev-only `pino-pretty` transport through Node's ESM-safe `createRequire(import.meta.url)` and falls back to structured output when it is unavailable.
- **`sensitive-field-policy.ts`** — the normalized protected-field vocabulary shared by structured logs, telemetry/Sentry scrubbing, and the executable log/metric schema. Add sensitive spellings here rather than creating surface-specific lists.
- **`traced-server-fn.ts`** — `tracedHandler()` wraps server function handlers with:
  - ALS-based request context with correlation IDs
  - Named request spans with timing (logs at debug level)
  - Repository methods wrapped with `trace()` for query-level timing
- **`request-context.ts`** — ALS-based per-request context storage
- **`trace.ts`** — `trace()` wrapper for repository-level query timing

## Cache (`shared/cache/`)

- **`cache.port.ts`** — cache interface (`get`, `set`, `delete`)
- **`redis-cache.ts`** — Redis-backed implementation
- **`noop-cache.ts`** — no-op implementation for dev/when Redis is unavailable
- **`redis.ts`** — shared Redis client

Production Cache Redis (`REDIS_URL`) and BullMQ Queue Redis
(`QUEUE_REDIS_URL`) are physically distinct per ADR 0053. Development/tests may
use the documented single-Redis fallback; production code must never add one.
Google refresh single-flight/backoff uses Cache Redis through an
Integration-owned port; keys are HMAC-derived, leases renew while provider
work is in flight, and the credential-generation database CAS is the durable
commit fence. Provider-ephemeral Redis remains physically separate and is not
used for this durable coordination metadata.

Queue Redis must pass the boot-time Redis 6.2+/GETDEL/`noeviction` inspection.
Producer connections remain bounded and fail fast; Worker blocking connections
retain `maxRetriesPerRequest: null`; every queue/client owns an error handler.
PostgreSQL may retry transient pool acquisition only—never replay a SQL statement
whose commit outcome may be ambiguous.

## Testing (`shared/testing/`)

In-memory port fakes for unit testing use cases without a database:

- `in-memory-identity-port.ts`, `in-memory-property-repo.ts`, `in-memory-team-repo.ts`, `in-memory-staff-assignment-repo.ts`
- `in-memory-portal-repo.ts`, `in-memory-portal-link-repo.ts`
- `in-memory-dashboard-repo.ts`, `in-memory-google-connection-repo.ts`, `in-memory-inbox-repo.ts`
- `in-memory-gbp-api-port.ts`, `in-memory-gbp-cache-repo.ts`, `in-memory-gbp-import-repo.ts`, `in-memory-gbp-queue-port.ts`
- `in-memory-google-oauth-port.ts`, `in-memory-token-encryption.ts`, `mock-logger.ts`
- `recorded-outbox.ts` — in-memory outbox the sequential command-store fakes record facts into, for assertions
- `fixtures.ts` — test data builders
- `integration-helpers.ts` — integration test utilities

**Test-only code.** Never imported from production modules. The ESLint
`boundaries` element types are the enforcing fence: `shared/testing/**` is the
`test-helpers` element and no production element lists it as an allowed target.

## Fallow analysis zones

`.fallowrc.json` analyses the test trees instead of ignoring them, because an
ignored tree silently drops import edges and a reachability report that misses
edges cannot justify a deletion. Excluding `shared/testing/**` hid the
`integration-helpers.ts` → `db/testing/test-organization-cleanup.ts` edge, so a
helper every integration test depends on read as an unused file.

Two explicit test zones carry that tree: `test-support`
(`shared/testing/**` plus `shared/db/testing/**`) and `architecture-fixtures`
(`shared/architecture/**`). Both must stay declared **before** the broad
`src/shared/**` zone — zone matching is first-match-wins, so the shared pattern
would otherwise swallow them and report their deliberate cross-context fixtures
as production boundary violations. Production zones may target `test-support`
only because their `.test.ts` files build fakes; the production-versus-test
fence above is what actually holds, not the analyser configuration.

`usedClassMembers` pins two structural contracts Fallow cannot resolve
syntactically: the Organization export storage-port methods, which are invoked
through the structural port rather than the concrete S3 class, and the
`_tag`/`code` fields on `Error` subclasses, which are read across serialization
boundaries. They are live behaviour, not dead code.

## Rules

- `shared/` imports from itself and external libs only
- **Exception:** `shared/events/events.ts` imports context event types to build the master `DomainEvent` union
- **Exception:** `shared/testing/` may import types from `contexts/` to implement test doubles
- Never put business logic in shared — only infrastructure and cross-cutting concerns
- Never put React code in shared (except `shared/hooks/*` — the client-side permission and capability hooks)
