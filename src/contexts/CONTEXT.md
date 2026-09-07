# Contexts — Context

**Audience:** Developers and agents working in `src/contexts/`.

## Responsibility

Ten bounded contexts own product meaning and state:

- **Identity** — users, Organizations, membership, access, and People facts.
- **Property** — Property identity, lifecycle, Google binding, and responsibility.
- **Portal** — public review gateways, publication, groups, links, and access artifacts.
- **Guest** — private responses, feedback, qualified actions, and integrity.
- **Integration** — Google connection, import, provider access, and Performance I/O.
- **Review** — stable external Reviews, source lifecycle, and manager Replies.
- **AI** — governed Review Analysis, Reply Drafting, and Property Trends.
- **Inbox** — triage Items, Handling Cycles, notes, and Response Targets.
- **Reporting** — Metric, Goal, and Dashboard read/reporting models.
- **Feed** — Recent Activity, Operational Action History, and notifications.

Each package's `CONTEXT.md` defines its owner, prohibited inferences, runtime entry
path, invariants, residual gaps, and verification authority.

## Package shape

- `domain/` owns pure types, rules, constructors, events, and tagged errors.
- `application/` owns use cases, DTOs, public interfaces, and effect ports.
- `infrastructure/` implements persistence, provider, consumer, and job effects.
- `server/` adapts authenticated TanStack Start calls to the built application API.
- `build.ts` is the context composition seam; thin contexts may omit empty folders.

Layer and runtime import boundaries are enforced by `eslint.config.js` and `scripts/check-architecture-boundary-controls.mjs`.

## Dependency rules

- Cross-context code imports only `application/public-api.ts` or implements a
  consumer-owned application port. Never import a foreign `domain/`,
  `infrastructure/`, `server/`, or non-public application module.
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

Business failures are real `Error` objects with enumerable `_tag` and `code`.
Factories live in the owning `domain/errors.ts`; server adapters narrow them with
`isXxxError`, map once to safe HTTP errors, and sanitize untagged failures. Ordinary
alternatives use outcome unions rather than failure-shaped objects.

## Verification

Pure rules and use cases have colocated unit tests. Persistence, transactional
fences, tenant isolation, and lifecycle behavior use PostgreSQL integration tests.
Build tests prove the named surfaces and runtime registrations each context owns.

Unknown files/dependencies and representative forbidden/allowed edges are enforced by `eslint.config.js` and `scripts/check-architecture-boundary-controls.mjs`.
