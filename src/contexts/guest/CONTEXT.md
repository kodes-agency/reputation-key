# Guest — Context

**Audience:** Developers and agents working in `src/contexts/guest/`.

## Responsibility

Guest-facing interactions on public Portal pages: diagnostic and qualified scans,
private star ratings, optional feedback, destination actions, response integrity,
and the separately consented but inactive Contact Request backend.

## Boundaries

- Guest endpoints are unauthenticated by design. Origin, CSRF, signed-session,
  PostgreSQL pressure, cache, and referrer controls protect public mutations.
- Guest resolves Portal state only through `PortalPublicApi`. Dashboard and
  Notification receive narrow content-free Guest public APIs and never read Guest
  tables directly.
- Rating/feedback bodies, contact material, session/network pseudonyms, and media
  remain Guest-owned. Inbox consumes identifier-only lifecycle facts.
- Contact Request has no domain event, log value, notification value, analytics dimension, Inbox field, AI input, or search field. Only content-free scope, lifecycle, authority basis, and reveal timestamps are retained.
- Lifecycle export and purge contributors remain outside `publicApi`; irreversible
  purge is reachable only through the reviewed Identity lifecycle coordinator.
- Not exported, and not queried: `guest_contact_requests` and its reveal audits (`portal.guest_contact` is safety-blocked, so exporting them would be an activation by the back door), `guest_response_session_bindings`, the `guest_qualified_scan` and `guest_destination_action` scopes in `idempotency_receipts`, `guest_network_pressure_records`, legacy `session_id`/`ip_hash` columns, and the rating/feedback source event ids.

## Model

A response begins with a required private rating. Every rating first offers the
same Google Review Action; eligible private feedback is additive. Each response
binds the exact Portal snapshot/configuration/locale evidence observed by the
Guest. Corrections and withdrawals are append-only and source-addressed.

A Qualified Scan is a server-verified QR/NFC Access Artifact observation, accepted
once per signed session and Portal in a rolling 24-hour window. Network Pressure
Records are seven-day, content-free, daily-rotating pseudonymous admission facts,
not Guest identity or analytics attribution.

A Contact Request is a separate consented aggregate, encrypted for exactly 30 days
and backend-only until its approval and handling requirements are met.

## Runtime

`build.ts` composes response lifecycle, public Portal resolution, qualified-action
stores, integrity reads, reconciliation, and retention. PostgreSQL receipts own
correctness; Redis provides abuse control and observation-loss monitoring. State,
source-event identities, and identifier-only outbox facts commit atomically.

Cleanup remains live even while `portal.guest_contact` is hard-blocked; it cannot submit, read, reveal, or withdraw a request.
Organization closure waits for Guest outbox publication before scrubbing guest-authored values.

## Invariants

1. Rating is an integer from 1 through 5. The initial response command cannot carry text; eligible feedback is a separate non-empty command capped at 2,000 characters.
2. **Anti-discouragement**: after a durable rating, Google is always first and identical for values 1–5. Private feedback is additive, never an alternative, prerequisite, delay, or replacement for Google.
3. If the Property-owned Google destination degrades after publication, the same first post-rating position shows gentle unavailable copy for every rating. Private feedback and secondary links remain usable, and no stale Google URI reaches the browser.
4. Later Portal edits, rollback, and rating corrections never rewrite captured experience evidence. Historical responses without reliable evidence remain explicitly unsnapshotted rather than inheriting current Portal state.
5. Client-provided channel labels never qualify a scan. Redis and the legacy diagnostic scan row are not qualification authority.
6. The guest-facing response view is a receipt: private feedback text, canonical response/session IDs, tenant/provider IDs, category IDs, and internal consent fields are never returned to the browser after submission.
7. Contact Request purpose and consent are explicit: omitted consent defaults to false, an email or optional name never implies consent or purpose, and phone is not an accepted field.
8. Reads deny Contact Request material at its 30-day deadline even before cleanup. Effective access is limited to the Portal creator, current assigned responsible managers, and AccountAdmins; unrelated Property Managers are not included.
9. Guest media is hard-blocked for the first beta cohort and has no public issuance, confirmation entry point, or persistence model.
10. Raw Guest IP addresses are never persisted. Network pseudonyms are separated by Organization, Portal, action class, UTC day, and derivation version so they cannot become a cross-purpose, global, or durable Guest identity.
11. Signed-session correctness is never replaced by network pressure: session bindings and destination/Qualified Scan receipts remain the dedupe and mutation authorities. Rating and private-feedback admission fail closed when either pressure store is unavailable; qualified-scan observation reports a retryable failure; an approved destination URL remains available when observation fails, without recording analytics.
12. True fail-open observation loss is durable and visible across replicas/process restarts through one global Cache Redis hash: a continuity epoch plus five-minute `scan`/`review_link` counters in a trailing 24-hour window, pruned on every access with a 24-hour-plus-one-bucket key TTL. Coverage and counters share the same evictable unit, so reset/eviction cannot silently remove one counter while leaving evidence that the window is complete. The key, fields, logs, and alerts contain no tenant, Portal, destination, session, network pseudonym, content, or analytics identity. If the monitor is absent, unreadable, reset, or still warming through its first full window, OperationsSnapshot marks `guest.observationLoss` degraded and the alert reports completeness as unknown rather than zero. Private rating is explicitly `not_applicable_durable`/zero here because its canonical response fact and outbox row commit atomically; retryable rating commands are never reclassified as analytics loss.
13. Missing historical lineage fails closed rather than adding a second reading or leaving a stale one.
14. `ratings`, `feedback` and `scan_events` are purged as **row deletes only**. They are physical-drop-blocked compatibility mirrors: the rows are guest content and must go, the tables must not. No phase issues a DROP or TRUNCATE.

## Verification

Unit tests stay beside public handlers, response lifecycle, pressure/observation
stores, integrity, reconciliation, retention, lifecycle, and export subjects.
PostgreSQL integration tests cover receipt atomicity, exact deadlines, replay,
withdrawal/reveal serialization, outbox readiness, and tenant fences.

The activation lifecycle remains absent from `build.ts`, server functions, routes, workers, and public API. Manager relationships are freshly resolved immediately before a Guest operation; the documented cross-transaction revocation interval must be accepted or replaced by a transactional permit before activation.

`portal.guest_contact` is safety-blocked for beta. The backend foundation and tests do not create an activation path. Tenant allowlists, E2E overrides, routes, UI, workers, and public APIs cannot enable it. The only composed job path is fail-closed cleanup of encrypted material already present in migration-compatible storage. Activation still requires named approval evidence for the guest notice, 30-day retention wording, manager handling, and delivery channel, plus an accepted disposition for the documented authority-revocation interval and production key lifecycle; phone remains excluded.
