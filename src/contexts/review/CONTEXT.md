# Review — Context

**Audience:** Developers and agents working in `src/contexts/review/`.

## Responsibility

Stable external-review identity, provider observation/content lifecycle, and
RepKey-owned Reply workflow. Provider-controlled content is a bounded cache; it
is not the identity or history authority.

## Boundaries

- Property supplies only current source-epoch facts; Integration invokes Review's
  sync admission contracts. All credential-bearing provider work stays in this
  deployment.
- Inbox receives content-free exact-current reply and Response Target authority;
  Metric may project a verified reputation fact but cannot infer provider truth.
- AI provider output is not a Reply. Only explicit adoption may create a draft,
  and Review receives only a boolean Portal Brand-current answer.
- Manager-authored Reply export and destructive lifecycle contributions stay
  outside `publicApi`; no request path may call them.
- Google-controlled Review/reply content, provider identifiers, observations, and
  reputation material are never exported as manager-authored data.

## Model

A stable Review survives source deletion and content expiry. Erasable source
content and immutable observations attach to numbered Material Review Revisions;
material changes and source-epoch carries create exact immutable bindings.

An internal Reply moves from draft through approval and a numbered publication
cycle. Provider acknowledgement enters `pending_observation`; only an exact current
Google Reply Observation proves publication. Publication authorizations, attempts,
and observations are append-only evidence with tenant, source, material, Reply,
and cycle fences.
Terminal/ambiguous outcomes may enter `publish_failed`; rejected replies can be re-drafted.

A Property reply library has at most one rendering profile and a retained set of
enabled or disabled templates. Settings edits templates by ID, so a title rename
updates in place. The operations importer deliberately remains title-keyed for
repeatability: re-importing a manager-renamed template&rsquo;s former source title
creates a separate row and never overwrites the renamed template.

## Runtime

`buildReviewContext` captures Review repositories, queues, use cases, and foreign public ports in one `registerWorkerJobs` runtime contribution. Composition supplies the canonical registry/background queue and Bootstrap invokes this one method with the parsed discovery interval; neither layer reconstructs Review job dependencies.

- **sync-property-reviews** — Fetches reviews from Google for a specific property/location. Triggered by `property.created` event or `refresh-expiring-reviews` job.
- **refresh-expiring-reviews** — Finds reviews expiring within 5 days, enqueues sync jobs to refresh them. Runs daily.
- **purge-expired-reviews** — compatibility entry point for the single Review source-content lifecycle authority. It keyset-checkpoints a frozen window and its recurring job accepts content-free eligibility `report` and expand/cache/observation/revision/legacy-reply `shadow` evidence only. Checkpoints bind mode, scope, window, and `(createdAt, ReviewId)` cursor. The connection/Property/Organization compatibility adapter and legacy raw-expiry repository seam also delegate here and are report-only in ordinary composition. The local authority has a bounded whole-page atomic `apply` path, but every page fails closed without both the exact apply confirmation and an injected approval seal that is revalidated on continuation; ordinary production composition supplies neither. The shared erasure/reconciliation/re-observation transaction has real-PostgreSQL concurrency, rollback, replay, and stable-identity coverage. Recurring activation still requires the REV-01 external shadow-parity seal, restore/erasure proof, and explicit cutover approval.
- **review.on-reply-publication-requested** — Durable worker consumer that independently recovers queue admission after a request-process interruption. It reloads the authoritative reply and only admits the intent's exact active cycle. Queue-add/receipt ambiguity is fenced by the deterministic reply+cycle BullMQ job ID.
- **publish-reply** — Executes one guarded provider write for an approved current cycle. Claim revalidates the cycle's named manager against current membership, effective `reply.manage`, and Property scope in the claim transaction; denial cancels the cycle without provider egress. A fresh authorized attempt may write once; a persisted uncertain `sending` attempt must complete targeted readback first and may resend only after a current absence observation. Acknowledged writes remain `pending_observation`; terminal/retryable/ambiguous failures follow the durable attempt state machine and reconciliation schedule.
- **reconcile-ambiguous-publications** — Globally single-flight across replicas through a PostgreSQL session advisory lease. It keyset-walks due provider-pending/ambiguous rows and performs provider reads only. A 240-second monotonic start deadline leaves 60 seconds inside the worker's 300-second timeout for an already-started bounded provider read, its checkpoint, reporting, and lease release; an unstarted suffix remains due for the next run.

## Invariants

1. Period reads use half-open bounds so adjacent Dashboard periods never
   double-count a Review.
2. A replay creates neither another observation nor another event; an older
   provider version cannot replace the current Review.
3. Serving reads deny provider content at its fetch-based hard expiry. Confirmed deletion/expiry removes the current cache and redacts provider-controlled values while preserving stable identity and manager history.
4. Provider-subject HMAC mappings, not erased Google identifiers, reconnect a
   re-observation. A collision fails closed.
5. Reply text is capped at `MAX_REPLY_LENGTH` (4096).
6. A changed grounded Brand Profile invalidates the pending AI operation and creates no draft; legacy provenance verification remains compatible.
7. Every publication cycle atomically commits Reply state and its identifier-only
   intent. Older cycles cannot admit or acknowledge newer work.
8. Provider write acknowledgement persists the exact attempt/correlation outcome as `pending_observation`; it never marks the Reply published and never closes Inbox work.
9. A persisted `sending` attempt is an uncertain provider outcome. The worker
   performs a targeted read before doing anything else. Exact live truth may
   confirm it and divergent truth may supersede it; absence, a missing Review,
   and failed reads remain ambiguous because Google may have accepted a reply
   without echoing it. No read outcome permits a second write for that attempt.
10. A stale observation or event cannot confirm a newer Reply cycle. Application
    agreement alone is not closure authority.
11. Count or average drift during or between reputation scans terminally fails the
    run. Zero Reviews is count `0` with average `null`.
12. Verified reputation facts contain no Review ID, provider identifier, reviewer,
    rating distribution, or text.
13. Reply profile and template field rules come from
    `application/dto/reply-library.dto.ts`; the Settings boundary, repository,
    and operations importer must not restate them.
14. Template edits and enabled-state changes are tenant-and-Property-scoped,
    versioned, attributed to the acting user, and leave version and attribution
    unchanged when the persisted value is unchanged.

## Verification

Unit tests stay beside material comparison, source lifecycle, Reply state,
observations, reconciliation, server contracts, workers, and build registration.
PostgreSQL integration tests cover immutable authorization, claim/revocation races,
atomic observation confirmation, replay, erasure, and verified snapshots.

Recurring activation remains quarantined until the external shadow-parity/cutover audit is complete.
