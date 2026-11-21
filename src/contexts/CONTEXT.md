# Contexts — Context

**Audience:** Developers and agents working in `src/contexts/`.

## Responsibility

Eleven areas own product meaning and state. Review, Inbox and Reputation are one
bounded context: Reputation holds its features (content, inbox, library,
publication, replies, response-targets, reviews, sync), its screens and the shared
`domain/`; Review and Inbox keep their server functions, public APIs, builds and
the few layer files their maps list.

- **Identity** — users, Organizations, membership, access, and People facts.
- **Property** — Property identity, lifecycle, Google binding, and responsibility.
- **Portal** — public review gateways, publication, groups, links, and access artifacts.
- **Guest** — private responses, feedback, qualified actions, and integrity.
- **Integration** — Google connection, import, provider access, and Performance I/O.
- **Review** — stable external Reviews, source lifecycle, and manager Replies.
- **AI** — governed Review Analysis, Reply Drafting, and Property Trends.
- **Inbox** — triage Items, Handling Cycles, notes, and Response Targets.
- **Reputation** — the Inbox, Reply, Review and Response Target features and screens, Review sync, Reply publication and provider content lifecycle.
- **Reporting** — Metric, Goal, and Dashboard read/reporting models.
- **Feed** — Operational Action History, retained Recent Activity records, and notifications.

Each package's `CONTEXT.md` defines its owner, prohibited inferences, runtime entry
path, invariants, residual gaps, and verification authority.

## Package shape

An area holds its features, and three things every feature shares:

- `<feature>/` is one capability, named in domain words (`members`,
  `publication`, `monthly-goals`):
  - `contracts.ts` holds the types and schemas the browser may import.
  - `*.server.ts` files hold commands, reads, stores, adapters, jobs and
    consumers. In a feature, only these may import Drizzle. No area file
    builds a queue or Redis client: `shared/jobs` and the composition root
    build them and pass them in, so area code imports `bullmq` and `ioredis`
    types only (tests may build real clients).
  - `ui/` holds screens, components, hooks and their stories. It has no index
    file and no `*.server.ts`.
  - Tests sit beside what they test; `*.test-fixtures.ts` holds shared test data.
- `domain/` owns the area's pure types, rules, constructors, events, and tagged
  errors. It imports no I/O, no framework and no clock.
- `server/` adapts authenticated TanStack Start calls to the built application
  API. Server-function paths are stable RPC entry points.
- `build.ts` and `build-*.ts` are the composition seam.
- `public-api.ts` is the one file another area may import. Review and Inbox keep `application/public-api.ts` until their server functions move.

`application/`, `infrastructure/` and `ports/` are the earlier layer folders.
They only shrink: add no production file to them (a test beside old code is
fine), and move a file out in a change that does nothing else.

### Adding a feature

1. Find the area in the list above. Use an existing feature folder when the
   capability already has one.
2. For a new one, create `src/contexts/<area>/<feature>/` and add its name to
   `LAYOUT.areas` in `scripts/ci/check-layout.ts` in the same change.
3. Put pure rules in the area's `domain/`, effects in `<feature>/<name>.server.ts`,
   browser-safe types in `<feature>/contracts.ts` (or `<name>.contracts.ts`) and
   screens in `<feature>/ui/`. The features of one area may use each other's
   server files; another area is reached only through its public API. A feature
   that outgrows one folder becomes two features, not a folder with sub-folders.
4. Expose a call to the browser as a server function in the area's `server/`.
   Expose a read or command to another area through the area's `public-api.ts`
   (Review and Inbox keep `application/public-api.ts` until their server functions move).
5. Wire new dependencies in `build.ts`.
6. Run `pnpm check:layout` and `pnpm lint`.

Places are enforced by `scripts/ci/check-layout.ts` (`pnpm check:layout`), whose
`LAYOUT` is the map of areas and features. Layer and runtime import boundaries
are enforced by `eslint.config.js` and `scripts/check-architecture-boundary-controls.mjs`.

## Dependency rules

- Cross-context code imports only an area's `public-api.ts` (Review and Inbox
  keep `application/public-api.ts` until their server functions move) or
  implements a consumer-owned application port. Never import a foreign `domain/`,
  `infrastructure/`, `server/`, or non-public application module. The port's
  implementation lives in `infrastructure/adapters/` or in a feature as
  `<name>.adapter.server.ts`; a feature's contracts may name another area's
  public types, as types only.
- A context owns its state changes and durable facts. Consumers react through
  registered outbox delivery; an event payload is not a foreign content cache.
- Extend the owning public interface when a required contract is missing. Do not
  suppress a boundary rule or create a second shared copy.
- Domain code is framework- and I/O-free. Infrastructure supplies effects through
  application ports; server adapters contain delivery concerns, not business rules.

Cross-context public-interface rules are enforced by `eslint-rules/cross-context-public-api.mjs` and `src/shared/architecture/cross-context-public-api.test.ts`.

## Composition

The root composes Identity → Property → Portal → Guest → Integration → Review →
AI → Inbox, then Reporting and Feed. Later dependencies arrive through public
interfaces or narrow late-bound closures; contexts never reorder construction by
reaching into another package's internals.

A build returns named surfaces such as `publicApi`, `worker`, `readiness`, and
`lifecycle`. Owning-context construction details may remain `internal` only for
root wiring; they are not presentation or cross-context APIs. Worker, consumer,
and schedule registration stays in the owning context and is invoked by the
shared bootstrap/runtime registry.

## Commands and errors

Application commands authorize the complete operation, load current facts, enforce
invariants, and commit state plus identifier-only outbox facts through an
owning-context transaction boundary. Public/anonymous flows instead use their
explicit origin, capability, signed-session, or provider admission contracts.

A server function asks the execution policy (`requireExecutionAllowed`) in its
handler or through a helper of the same `server/` layer, before it calls the
application. The ones that do not are listed, each with the guard it asks
instead, in `src/shared/architecture/server-function-policy-exemptions.ts`: a
caller the policy does not know (a guest, a person signing in, a platform
operator, an account with no Organization yet), a signed-in member's read of
what is available to them, and the Google Performance reads and public link
resolution, where the application asks the policy below the adapter.
`src/shared/architecture/server-function-policy.test.ts` fails on a handler that
does neither, and on a server function declared in a shape it cannot read.

Business failures are real `Error` objects with enumerable `_tag` and `code`.
Factories live in the owning area's `domain/errors.ts`, or `domain/<family>-errors.ts`
where one domain holds two families (Feed's activity and notification, Reputation's
review and inbox); server adapters narrow them with
`isXxxError`, map once to safe HTTP errors, and sanitize untagged failures. Ordinary
alternatives use outcome unions rather than failure-shaped objects.

## Verification

Pure rules and use cases have colocated unit tests. Persistence, transactional
fences, tenant isolation, and lifecycle behavior use PostgreSQL integration tests.
Build tests prove the named surfaces and runtime registrations each context owns.

Unknown files/dependencies and representative forbidden/allowed edges are enforced by `eslint.config.js` and `scripts/check-architecture-boundary-controls.mjs`.
