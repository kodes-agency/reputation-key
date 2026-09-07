# Feed — Context

**Audience:** Developers and agents working in `src/contexts/feed/`.

## Responsibility

Feed owns two related downstream experiences:

- Recent Activity and restricted Operational Action History projections.
- In-app notifications, notification preferences, email queueing, digests, and
  one-click unsubscribe.

It consumes durable, identifier-only facts from upstream contexts. It does not
own source review, inbox, property, portal, identity, or goal state.

## Boundaries

- Cross-context consumers import only `application/public-api.ts` or a Feed
  server function.
- `buildFeedContext` is the sole composition module. Its `activity` and
  `notification` dependency records preserve the former independent build
  boundaries, while its `publicApi` merges both surfaces.
- Activity and notification lifecycle/export contributor identifiers remain
  distinct because the persisted lifecycle and archive contracts distinguish
  those data families.
- The notification audience may read Goal monthly-result facts only through
  Goal's application public API.

## Model

Recent Activity is a privacy-filtered operational projection, not an event log
or source-content archive. Operational Action History is append-oriented,
organization-scoped evidence with restricted list/export access and legal-hold
handling.

Notifications are mutable delivery records. Copy is rendered from typed
payloads at read/send time so in-app rows, urgent email, and digests cannot
silently drift. Preferences and current responsibility are rechecked before
external delivery.

## Runtime

Durable outbox consumers project activity and enqueue deterministic notification
jobs. The activity worker also exposes bounded projection recovery. Notification
jobs perform insert, urgent-email, digest, and missing-notification repair work.
All queue, clock, logger, identifier, and upstream lookup dependencies are
provided by composition; modules do not read ambient roots.

## Invariants

1. Durable facts and queue payloads contain identifiers and governed facts, not
   review text, reply text, notes, reviewer identity, or provider snippets.
2. Every read and mutation remains organization-scoped; notification mutations
   additionally prove row ownership by the current user.
3. Activity replay and notification delivery are idempotent. Redelivery must
   converge through receipts and deterministic identities.
4. Email delivery rechecks preference, capability, responsibility, and delayed
   execution policy immediately before the provider effect.
5. User-facing notification copy is produced only by
   `domain/notification-templates.ts`.
6. Operational Action History list/export responses are private and no-store.

## Verification

Unit tests stay beside domain rules, use cases, consumers, jobs, and server
contracts. PostgreSQL-backed repository, recovery, delivery, export, and
lifecycle tests stay beside their infrastructure subjects. The build test pins
that one Feed build exposes both former APIs without widening either lifecycle
surface.
