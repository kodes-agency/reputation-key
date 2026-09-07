# Shared — Context

**Audience:** Developers and agents working in `src/shared/`.

## Responsibility

Shared owns reusable infrastructure and genuinely cross-context primitives. It does not take product meaning away from a bounded context. Wait for a second real consumer before extracting code here; context-specific policy stays with its owner.

Primary areas:

- `auth/`, `security/`, `rate-limit/`, `provider-ephemeral/`, and
  `google-provider-control/` own reusable admission and transport fences.
- `db/`, `events/`, `outbox/`, and `jobs/` own durable storage/delivery mechanics.
- `architecture/` and `governance/` hold executable boundaries and catalogues.
- `health/` and `observability/` expose content-minimal runtime evidence.
- `domain/`, `http/`, `email/`, `cache/`, and `lifecycle/` hold small mechanisms.
- `hooks/` and `queries/` are browser-safe cross-feature access/cache utilities.
- `ops/` and `release/` own reviewed operational and promotion contracts.
- `testing/` and `db/testing/` are test-only support, never runtime authorities.

Shared-area dependency and production/test fences are enforced by `eslint.config.js` and `scripts/check-architecture-boundary-controls.mjs`.

## Root contracts

The shared root is not a general placement target. Its retained files are narrow multi-owner contracts: AI/provider schemas and pinned vectors, canonical JSON, closed JSON validation, merchant-AI notices, Reply language, responsible-manager eligibility, Google Review/Performance wire normalization, and provider-subject bindings. New workflow orchestration belongs in an owning context.

AI and Google contracts state their semantic owner explicitly. Browser-safe
catalogues must not pull Node crypto, provider clients, configuration, queues, or
persistence into the client graph. Raw provider/review content and credentials do
not belong in shared contract records.

Browser/server reachability is enforced by `src/shared/architecture/browser-reachability.test.ts` and `eslint.config.js`.

## Authentication and runtime

`auth/middleware.ts` resolves tenant context through the staged tenant resolver.
`headersFromContext()` is asynchronous and uses a dynamic server import because its
module is browser-reachable; every server caller must await it. Tagged auth errors
are mapped once at the delivery boundary.

Cache Redis and Queue Redis are physically distinct in production. Cache
single-flight/backoff remains Integration-owned through a shared mechanism;
credential generation in PostgreSQL is the durable commit fence. Queue Redis must
use `noeviction`; PostgreSQL may retry pool acquisition only, never a SQL statement
whose commit outcome is ambiguous.

Jobs, outbox delivery, health, and observability expose infrastructure mechanics.
Contexts own handler meaning, source transactions, recovery policy, content
classification, and mutation authority.

## Domain and boundaries

`shared/domain/` contains pure cross-context identifiers, result/error primitives,
roles, calendars, timezones, encodings, and small eligibility rules. A type with one
owner belongs with that owner. No I/O or framework code enters this area.

Cross-context product behavior remains behind each context's
`application/public-api.ts` or a consumer-owned port. Shared events aggregate the
master event union but do not gain permission to construct another context's fact.

Cross-context public-interface boundaries are enforced by `eslint-rules/cross-context-public-api.mjs` and `src/shared/architecture/cross-context-public-api.test.ts`.

## Testing

`shared/testing/` contains fakes, fixtures, environment leases, and integration
harnesses. Production code must never import it. Test and architecture-fixture
zones remain distinct so static reachability analysis sees their intentional
cross-context edges without treating them as production dependencies.

The production/test import fence is enforced by `eslint.config.js` and `scripts/check-architecture-boundary-controls.mjs`.

## Verification

Keep unit tests beside each shared contract. Use PostgreSQL/Redis integration tests
for real persistence, leases, delivery, and failure ambiguity. Architecture and
governance tests prove boundaries, protected fields, public interfaces, browser
reachability, runtime registration, and authoritative catalogues.
