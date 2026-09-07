# Guest Context

## Bounded context

Guest-facing interactions on public portal pages. Covers scan tracking, star ratings, feedback submission, and review-link click tracking.

## Glossary

- **Guest** — A person visiting a public portal page to rate their experience. Unauthenticated — no login required.
- **ScanEvent** — A recorded visit to a public portal page, captured on page load with `source` attribution (`qr`, `nfc`, `direct`). Tracks `portalId`, `propertyId`, timestamp.
- **Rating** — A 1–5 star rating submitted by a guest for a specific portal visit. NOT the same as Review Rating (review context, public/platform rating).
- **Feedback** — Optional free-text note (max 2,000 characters) submitted only after an eligible private rating. It is private and routed to the managers responsible for the Portal.
- **Contact Request** — A separately consented manager-follow-up request with a valid email and optional name. It is not part of a Rating or Feedback, is encrypted for exactly 30 days, and remains backend-only until its notice and handling approvals exist.
- **Google Review Selection** — The post-rating choice to open the Property-owned Google review destination. It is offered with identical order and prominence for all five ratings and is recorded as core analytics.
- **Qualified Link Action** — An explicit post-render, origin/CSRF/session-bound mutation for a destination classified as `google_review` or `secondary_link`. A redirect GET is navigation only and never increments it.
- **Qualified Scan** — A server-verified observation of a published RepKey QR/NFC Access Artifact, accepted once per signed response session and Portal in a rolling 24-hour window. Direct visits, speculative fetches, and automated agents remain diagnostic visits only.
- **Network Pressure Record** — A content-free, Organization/Property/Portal-scoped admission record containing only a daily-rotating keyed pseudonym, one public-action class, observation time, and exact seven-day expiry. It is neither Guest identity nor an analytics/staff-attribution fact.
- **Response Integrity Outcome** — The current, content-free classification of a retained rating response: `Accepted`, `Filtered automatically`, or `Under review`. It governs headline metric eligibility independently of feedback moderation.
- **Source** — How the guest arrived at the portal: `qr` (QR code scan), `nfc` (NFC tap), or `direct` (typed URL).

## Relationships

- A **Guest** visit produces a **Scan Event** on page load
- A valid Access Artifact visit may additionally produce one identifier-only **Qualified Scan** with the Portal Group captured at event time.
- A **Guest** submits a **Rating** by interacting with the star widget on a portal page
- A **Rating** is always followed first by the same Google Review Action. An eligible rating may then add private feedback; secondary links follow both.
- A destination action is tracked through an explicit mutation; the redirect GET remains an untracked no-JavaScript/failure fallback.
- All guest interactions are tied to a **Session Cookie** (no PII)
- The Portal's inclusive threshold is snapshotted with the initial rating. Rating corrections may unlock feedback but never erase feedback already submitted.
- **Anti-discouragement** compliance ensures the Google Review Action has identical copy, order, timing, and prominence for every rating.
- Guest context **depends on** `PortalPublicApi` for portal resolution and public portal data.
- Notification consumes Guest's content-free `findPortalIdForFeedback` public API; Guest retains ownership of canonical and legacy response attribution.
- Dashboard consumes Guest's content-free `getPortalResponseIntegritySummary` public API for manager methodology. It never reads Guest tables directly and receives counts only.

## Invariants

- Rating must be an integer 1–5 (`validateRating`). Non-integer or out-of-range values are rejected.
- The initial response command requires a private rating and cannot carry text. Eligible private feedback is a separate atomic command, max 2,000 characters and non-empty after trim; CRLF/lone-CR inputs normalize to LF while paragraph breaks are preserved.
- Every new rating atomically stores a separate experience snapshot: the immutable Portal publication snapshot ID/version/digest, published-state marker, SHA-256 content version of the exact server-rendered configuration, actual guest locale, Guest UI language-pack version, inclusive feedback threshold, and capture time. A composite database reference prevents mismatched publication evidence. Later Portal edits, rollback, and rating corrections never rewrite it. Historical responses without reliable evidence remain explicitly unsnapshotted rather than inheriting current Portal state.
- Legacy readiness is observed through a deterministic read-only report at an explicit time. It classifies retained Rating/Feedback/session evidence and every durable rating/feedback fact without printing content or session/network identifiers, never infers provenance, and preserves separate per-star plus source/correction/retraction parity evidence. Historical event versions that predate Staff Attribution or feedback revision remain explicitly unknown; malformed payloads are classified by event ID instead of being normalized or aborting the report. Readiness requires both zero non-exact rows and exact canonical-effective/durable-rating-head parity.
- Scan source must be one of `qr`, `nfc`, `direct` (`validateSource`).
- Client-provided channel labels never qualify a scan. Qualification requires the Access Artifact ID from the generated URL, an ordinary browser user agent, no `prefetch`/`prerender` purpose header, the signed Portal session/CSRF mutation, and Portal-owned verification of the artifact, token, scope, publication state, and exact active Publication Snapshot.
- Qualified Scan correctness is PostgreSQL-owned: an advisory lock serializes `(Organization, Portal, signed session)`, an expiring receipt enforces the rolling 24-hour window, and only an accepted scan commits `guest.qualified_scan.recorded`. At the exact expiry instant a new scan is eligible; the bounded retention sweep deletes the session receipt at expiry without deleting the identifier-only Qualified Scan. Redis and the legacy diagnostic scan row are not qualification authority.
- Durable Qualified Scan rows retain identifiers, event time, Access Artifact ID, and captured Portal Group ID only. Session pseudonyms exist only in the short-lived dedupe receipt; user agent, IP hash, raw token, and guest content are absent from the durable fact.
- A Qualified Scan correction is append-only and source-addressed: the retained row is marked retracted once and `guest.qualified_scan.retracted` targets its original source event. Replay creates neither a second correction nor a synthetic zero.
- Session cookie (maximum 24h, `HttpOnly`, `rk_guest_session`) prevents duplicate ratings within the same session.
- **Anti-discouragement**: after a durable rating, Google is always first and identical for values 1–5. Private feedback is additive, never an alternative, prerequisite, delay, or replacement for Google.
- If the Property-owned Google destination degrades after publication, the same first post-rating position shows gentle unavailable copy for every rating. Private feedback and secondary links remain usable, and no stale Google URI reaches the browser.
- The guest-facing response view is a receipt: private feedback text, canonical response/session IDs, tenant/provider IDs, category IDs, and internal consent fields are never returned to the browser after submission.
- For 24 hours after private-feedback submission, the same signed session may withdraw only that feedback. The command purges text, records `guest.feedback.retracted` in the outbox, and leaves the private rating and its lineage intact. A content-free withdrawal tombstone prevents resubmission; separately consented Contact Request lifecycle is not inferred from feedback consent.
- Contact Request purpose and consent are explicit: omitted consent defaults to false, an email or optional name never implies consent or purpose, and phone is not an accepted field. The request references one exact Organization/Property/Portal/Guest Response scope but persists in its own table and aggregate.
- Contact Request values use versioned AES-256-GCM material bound to the Organization, Property, Portal, and request ID. Ordinary reads select only a constant masked projection. A plaintext reveal occurs only in a locked transaction that rechecks current membership, exact scope, and current Property access for a PropertyManager, then appends content-free reveal evidence. Effective access is limited to the Portal creator, current assigned responsible managers, and AccountAdmins; unrelated Property Managers are not included.
- Contact Request material expires exactly 30 days after submission. Reads deny it at the deadline even before cleanup. A serialized, bounded purge authority keeps a durable checkpoint while rechecking all eligible rows on every run, so restart, restore, or older backfilled rows cannot hide behind a cursor.
- Contact Request withdrawal and reveal lock the same row. Whichever commits first establishes the serial order; withdrawal always clears consent and encrypted material. A linked whole-response withdrawal clears Contact Request material in the same database transaction.
- Contact Request has no domain event, log value, notification value, analytics dimension, Inbox field, AI input, or search field. Only content-free scope, lifecycle, authority basis, and reveal timestamps are retained.
- For 24 hours after the initial rating, the same signed session may instead withdraw the entire response. That terminal command retracts rating and any still-effective feedback, purges content, and schedules media deletion.
- Retention classes are physically separate: the response recovery binding is re-signed to the committed rating/feedback withdrawal deadline (exactly 24 hours from that action, never a rolling retry extension), private-feedback body lasts at most 90 days, and the content-free response fact/tombstone lasts 24 calendar months. Repository reads deny expired binding/text even before the bounded evidence-producing sweep deletes it.
- “Start a new response” is available only after this signed session has a durable rating. It rotates the cookie/CSRF recovery identity and cached receipt without correcting, withdrawing, or deleting the earlier response; both session and rotating-network/Portal rate limits bound shared-device abuse.
- Every new rating has an append-only initial integrity decision. A valid, rate-limited honeypot submission is retained as `Filtered automatically` and records no rating fact; invalid traffic still receives the indistinguishable decoy. No rating value, feedback text, or guest identity participates in that decision.
- Integrity decisions use reasoned compare-and-set revisions. Exclusion atomically retracts the currently effective rating fact; restoration records the current corrected value at its original/corrected business time, so review timing cannot shift a monthly metric period.
- Manager moderation may hide abusive text but never changes the integrity outcome, retracts the rating fact, or deletes the numeric star value. Integrity review remains an internal control with no manager exclusion endpoint.
- The receipt advertises rating correction only through the exact one-hour domain deadline. The server remains authoritative and permits at most one correction.
- The first action per signed session, Portal, kind, and destination commits a 24-hour dedupe receipt and content-free durable fact atomically. Duplicate/replayed actions create no second fact; Redis is abuse control, not correctness authority.
- Guest media is hard-blocked for the first beta cohort and has no public issuance, confirmation entry point, or persistence model.
- Public rating, private-feedback, destination-action, and qualified-scan pressure checks use one canonical PostgreSQL authority after signed-session/CSRF and Redis checks. Each admitted action records only its Organization/Property/Portal scope, daily-rotating HMAC-SHA256 pseudonym, action class, observation time, and database-enforced expiry exactly seven days later. The record contains no session, destination, source, content, rating, staff, or analytics identity; it never feeds staff attribution or metrics.
- Raw Guest IP addresses are never persisted. Network pseudonyms are separated by Organization, Portal, action class, UTC day, and derivation version so they cannot become a cross-purpose, global, or durable Guest identity. Shared-device session rotation remains available and is bounded independently by the Portal-scoped network layer.
- Signed-session correctness is never replaced by network pressure: session bindings and destination/Qualified Scan receipts remain the dedupe and mutation authorities. Rating and private-feedback admission fail closed when either pressure store is unavailable; qualified-scan observation reports a retryable failure; an approved destination URL remains available when observation fails, without recording analytics.
- True fail-open observation loss is durable and visible across replicas/process restarts through one global Cache Redis hash: a continuity epoch plus five-minute `scan`/`review_link` counters in a trailing 24-hour window, pruned on every access with a 24-hour-plus-one-bucket key TTL. Coverage and counters share the same evictable unit, so reset/eviction cannot silently remove one counter while leaving evidence that the window is complete. The key, fields, logs, and alerts contain no tenant, Portal, destination, session, network pseudonym, content, or analytics identity. If the monitor is absent, unreadable, reset, or still warming through its first full window, OperationsSnapshot marks `guest.observationLoss` degraded and the alert reports completeness as unknown rather than zero. Private rating is explicitly `not_applicable_durable`/zero here because its canonical response fact and outbox row commit atomically; retryable rating commands are never reclassified as analytics loss.
- Every public Guest handler applies `private, no-store` and `no-referrer` before any branch or decoy return; cookie-bound reads/mutations also emit `Vary: Cookie`. The cookie-independent direct-link resolver omits only that variance while its HTTP redirect and non-enumerating failure response enforce the same cache/referrer policy.
- Migration 0142 clears every legacy `ratings.ip_hash`, `feedback.ip_hash`, and `scan_events.ip_hash` without importing them: v1 values lacked Portal and action-class derivation separation and therefore cannot safely enter the canonical authority. Canonical writes keep those compatibility columns null, while their older retention rules remain restore/backfill defence only.

## Events produced

| Tag                              | Payload                                                                                        | When recorded                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `guest.scan.recorded`            | scanId, organizationId, portalId, propertyId, scanSource, occurredAt                           | A diagnostic Portal visit is recorded                                                                      |
| `guest.qualified_scan.recorded`  | qualifiedScanId, scope IDs, event-time portalGroupId, accessArtifactId, occurredAt             | Database-backed 24-hour dedupe accepts an identifier-only Access Artifact observation                      |
| `guest.qualified_scan.retracted` | qualified-scan provenance, supersedesSourceEventId, occurredAt                                 | A governed correction retracts the original Qualified Scan contribution                                    |
| `guest.rating.submitted`         | ratingId, scope IDs, value, sourceEventId, staffAttribution, occurredAt                        | An accepted private rating or restored corrected rating becomes the effective metric fact                  |
| `guest.rating.retracted`         | ratingId, scope IDs, supersedesSourceEventId, staffAttribution, occurredAt                     | A correction removes consent/value or the guest withdraws the response                                     |
| `guest.feedback.submitted`       | feedbackId, scope IDs, ratingId, sourceEventId, responseRevision, staffAttribution, occurredAt | The separate eligible private-feedback command commits without consuming the rating correction             |
| `guest.feedback.retracted`       | feedbackId, scope IDs, supersedesSourceEventId, responseRevision, staffAttribution, occurredAt | Feedback withdrawal/correction updates projections and related Inbox work without carrying text or contact |
| `guest.review_link.clicked`      | linkId, destinationKind, organizationId, portalId, propertyId, occurredAt                      | A qualified Google-review or secondary-link action wins its durable dedupe receipt                         |

The canonical response stores the currently effective rating/feedback source-event ids. Corrections and withdrawals commit their state transition and every replacement/retraction fact in one transaction. Missing historical lineage fails closed rather than adding a second reading or leaving a stale one.

Integrity decisions themselves are append-only rows in
`guest_response_integrity_decisions`. They intentionally contain scope,
revision, outcomes, reason/source/actor, and time—but no rating, text, session,
or network pseudonym. Legacy review-link facts without a destination kind decode
as `secondary_link`; new Google selections are explicit.

## Events consumed

None. Guest context does not subscribe to events from other contexts.

## Architecture layers

```
guest/
  domain/              types.ts, networkPressure.ts, constructors.ts, events.ts, errors.ts, rules.ts
  application/
    guest-response-reconciliation.ts
    ports/             guest-interaction.repository.ts, guest-observation-store.port.ts,
                       guest-network-pressure.store.port.ts,
                       portal-context-resolver.port.ts,
                       public-portal-lookup.port.ts, contact-request.repository.ts,
                       contact-request-encryption.port.ts,
                       contact-request-manager-authority.port.ts
    dto/               public-portal.dto.ts, contact-request.dto.ts,
                       private-feedback.dto.ts
    use-cases/         record-scan.ts, consume-guest-network-pressure.ts,
                       guest-response-lifecycle.ts,
                       contact-request-lifecycle.ts,
                       get-portal-response-integrity-summary.ts,
                       track-review-link-click.ts, resolve-link-and-track.ts,
                       resolve-portal-context.ts, get-public-portal.ts
    public-api.ts      re-exports domain types, event types/constructors
  infrastructure/     guest-observation-store.ts (diagnostic/Qualified Scan state + facts)
                      guest-network-pressure.store.ts (serialized seven-day pressure authority)
    repositories/      guest-interaction.repository.ts
                       contact-request.repository.ts
    adapters/           contact-request-encryption.adapter.ts,
                        guest-organization-export.adapter.ts
    feedback-portal-attribution.ts  tenant-scoped, content-free source lookup
    mappers/           guest.mapper.ts
    resolvers/         portal-context-resolver.ts, public-portal-lookup.ts
  server/              public.ts, guest-scans.ts
  build.ts             composition root
```

## Use cases

- **`recordScan`** — Always records a legacy diagnostic visit; additionally verifies a supplied Access Artifact and commits at most one Qualified Scan per signed session/Portal in 24 hours.
- **`consumeGuestNetworkPressure`** — Serializes a Portal-scoped public-action admission decision, counts the configured half-open window, and writes one content-free record only when admitted.
- **`responseLifecycle`** — Submit the required private rating, add eligible private feedback, withdraw only that feedback within 24 hours, correct the rating once, and withdraw/moderate the aggregate. State and content-free facts commit atomically.
- **`contactRequestLifecycle`** — Backend-only submit, masked read, audited just-in-time reveal, and withdrawal. The activation lifecycle remains absent from `build.ts`, server functions, routes, workers, and public API. Readiness wiring composes only the exact signed-session response authority, the owning-context manager-authority adapter, and the independent retention sweep. Manager relationships are freshly resolved immediately before a Guest operation; the documented cross-transaction revocation interval must be accepted or replaced by a transactional permit before activation.
- **`contactRequestRetentionSweep`** — Unconditionally drains the repository's serialized 30-day encrypted-material expiry in bounded batches at one fixed observation time. It is invoked by the established daily retention job and records content-free `retention_runs` redaction evidence. Cleanup remains live even while `portal.guest_contact` is hard-blocked; it cannot submit, read, reveal, or withdraw a request.
- **`trackReviewLinkClick`** — Atomically commit the short-lived classified action receipt and `guest.review_link.clicked`; persistence failure is reported but never blocks an approved navigation.
- **`resolveLinkAndTrack`** — Resolve a token-owned Portal link. It tracks only when the explicit POST edge supplies a qualified signed session; calls from the redirect GET resolve without analytics.
- **`resolvePortalContext`** — Resolve org + property from portal ID.
- **`getPublicPortal`** — Fetch full public portal data for guest-facing rendering.
- **`getPortalResponseIntegritySummary`** — Return content-free current outcome counts for rating responses in one tenant/Property/Portal and half-open business period.
- **`buildGuestResponseReconciliationReport`** — Canonicalize the identifier-only GST-01 legacy/canonical readiness inventory, per-star distributions, and durable source/supersession/retraction identities at one explicit observation time. Its database adapter is repeatable-read and read-only; the operator command has no apply mode.

## Public API

Exported from `application/public-api.ts`:

- Types: `ScanEvent`, `Rating`, `Feedback`, `PortalResponseIntegritySummary`
- Event types: `GuestScanRecorded`, `GuestQualifiedScanRecorded`, `GuestQualifiedScanRetracted`, `GuestRatingSubmitted`, `GuestRatingRetracted`, `GuestFeedbackSubmitted`, `GuestFeedbackRetracted`, `GuestReviewLinkClicked`, `GuestEvent`
- Event constructors: `guestScanRecorded`, `guestRatingSubmitted`, `guestFeedbackSubmitted`, `guestFeedbackRetracted`

## Server functions

- **`public.ts`** — Guest-facing origin/CSRF/signed-session mutations for rating, feedback submission/withdrawal, Google selection, secondary-link selection, rating correction, shared-device recovery rotation, and whole-response withdrawal.
- **`guest-scans.ts`** — Visit recording, public Portal read, and the navigation-only secondary-link resolver.

## Permissions

Guest context is entirely public — no authentication is required for any endpoint. All server functions are unauthenticated (`public` permission level). These are logical operation identifiers for tracing/auditing only. All guest endpoints are unauthenticated (public by design). No `can()` enforcement exists because guest context has no auth middleware.

- `scan:create` — Record a portal visit. Public.
- `rating:create` — Submit a star rating. Public.
- `feedback:create` — Submit feedback text. Public.
- `review_link:click` — Track a review link click. Public.
- `portal:read` — Read public portal data (name, description, links). Public.
- `feedback.read` — Reserved for future use (viewing feedback history).
- `feedback.handle` — Internal Inbox handling for submitted private feedback; distinct from collection and moderation.
- `feedback.respond` — Reserved for future use (responding to guest feedback).

## Contact Request activation

`portal.guest_contact` is safety-blocked for beta. The backend foundation and tests do not create an activation path. Tenant allowlists, E2E overrides, routes, UI, workers, and public APIs cannot enable it. The only composed job path is fail-closed cleanup of encrypted material already present in migration-compatible storage. Activation still requires named approval evidence for the guest notice, 30-day retention wording, manager handling, and delivery channel, plus an accepted disposition for the documented authority-revocation interval and production key lifecycle; phone remains excluded.

## Organization Export contribution (LIF-01)

`infrastructure/adapters/guest-organization-export.adapter.ts` implements
`identity/application/ports/organization-export-contributor.port.ts` and is
returned from `build.ts` as `organizationExportContributor` — deliberately
outside `publicApi`, because an export slice is lifecycle composition input,
not a Guest product capability.

Emitted, always for a fixed `(organizationId, asOf)` and in UTF-8 byte order:

| Entry                                  | Classification            | Source                                                                                                                  |
| -------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `guest/responses.csv` / `.json`        | `tenant_visible`          | `guest_responses`, `guest_qualified_scans`, `guest_response_integrity_decisions`, `guest_response_experience_snapshots` |
| `guest/legacy-responses.csv` / `.json` | `tenant_visible`          | `ratings`, `feedback`, `scan_events` — only rows with no canonical successor, so nothing is double-counted              |
| `guest/private-feedback.csv` / `.json` | `permitted_guest_content` | `guest_response_private_feedback` still inside its 90-day window, plus unmapped legacy `feedback.comment`               |

A family with no rows is not emitted; an Organization with no Guest rows
answers `no_data`. Expired private text renders as
`private_feedback_state: "expired"` beside a response that still records that
feedback was received — never as empty text.

Not exported, and not queried: `guest_contact_requests` and its reveal audits
(`portal.guest_contact` is safety-blocked, so exporting them would be an
activation by the back door), `guest_response_session_bindings`,
`guest_qualified_scan_receipts`, `guest_destination_action_receipts`,
`guest_network_pressure_records`, legacy `session_id`/`ip_hash` columns, and
the rating/feedback source event ids. Each
reason is recorded in the payload's `excludedRecordClasses`.

## Organization lifecycle contribution (LIF-01)

`infrastructure/adapters/guest-organization-lifecycle.adapter.ts` implements
`identity/application/ports/organization-lifecycle-contributor.port.ts` on top
of the shared receipt store
(`shared/db/lifecycle/organization-lifecycle-receipt-store.ts`), and is
returned from `build.ts` as `organizationLifecycleContributor` — deliberately
outside `publicApi`. It owns an irreversible scrub of the most sensitive rows
in the product, so keeping it off the request-facing surface is what keeps that
phase unreachable by default.

| Phase                  | What Guest does                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepareClosing`       | **Mutates nothing**, and still answers. Every public Guest write re-resolves the Portal by its address token, which requires both a live publication activation and `isPropertyActive`; Portal and Property fence both in the same phase, so Guest has no admission of its own to cancel — and Closing is a recoverable window that must keep the data. |
| `verifyPurgeReadiness` | Read-only. Fails closed while any Guest-sourced `outbox_events` row for the Organization is unpublished, so corrections, withdrawals and scan retractions reach the anonymous `portal_metric_lifetime_aggregates` row BEFORE the source facts are scrubbed.                                                                                             |
| `purge`                | Idempotent row deletes over `GUEST_PURGE_PLAN`, innermost dependency first.                                                                                                                                                                                                                                                                             |

Purge removes every guest-authored value: private feedback bodies, legacy
feedback comments, ratings, permitted contact ciphertext and its key id, media
object keys, session pseudonyms and network pseudonyms.

Deliberately retained:

- `portal_metric_lifetime_aggregates` — the anonymous lifetime aggregate the
  metrics depend on. It is Metric's row and Metric's receipt; Guest never edits
  or deletes it, and the readiness gate above is what keeps it correct.
- `guest_contact_request_purge_checkpoints` — a single global cursor for the
  serialized 30-day retention authority. It has no `organization_id` and no
  tenant content; deleting it would corrupt an unrelated running sweep.
- `user` rows and other owners' rows. A person who is a member of another
  Organization keeps their identity; Identity owns identities.

`ratings`, `feedback` and `scan_events` are purged as **row deletes only**.
They are physical-drop-blocked compatibility mirrors: the rows are guest
content and must go, the tables must not. No phase issues a DROP or TRUNCATE.
