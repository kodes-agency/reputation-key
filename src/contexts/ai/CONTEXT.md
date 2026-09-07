# AI context

## Bounded context

The AI context owns governed AI authorization reads, operation admission,
provider-inference orchestration, derivative output lineage/lifecycle, Review
Analysis enrollment, deterministic Property Trends, and on-demand Reply Drafting.
It does not own Google Review source content, Property access, Inbox workflow,
Reply publication, Portal/Guest data, metrics, goals, or notifications.

## Public boundary

- Cross-context and presentation-facing types/events are exported only through
  `application/public-api.ts`.
- `build.ts` is the composition-root boundary. Other contexts do not construct
  AI repositories, provider adapters, jobs, or control stores.
- Server functions are authenticated delivery adapters; they call the built
  `publicApi` and are not domain authority.

## Fixed beta capabilities

| Capability      | Product behavior                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Review Analysis | Derivative metadata for eligible Google Review content, independently controlled per Property.   |
| Reply Drafting  | Genuine on-demand personalized draft; editable and always returned to human Confirm & Publish.   |
| Property Trends | Deterministic aggregation of completed Review Analysis; never a second provider-generation call. |

All three are dark until the AccountAdmin authorization, live access, notice
version, provider policy, platform gate, runtime catalogue, and cell-local
admission/egress controls agree. Property Trends additionally requires Review
Analysis. A capability being present in code or schema is not activation.

## Invariants

1. AI processes only currently eligible Google Review content loaded through the
   Review public source port plus the exact public Property display name loaded
   through Portal's narrow Brand authority. Brand image URLs, colors, localized
   content, Private Portal ratings, feedback, contact details, Inbox notes,
   manager-internal text, and Guest media never enter AI admission, prompts,
   outputs, logs, or derived tables.
2. Every operation is fenced by Organization, Property, source epoch,
   source revision, authorization epoch, capability epoch, policy/profile
   versions, model/deployment, idempotency key, and lifecycle generation.
3. Authorization is a maximum allowed capability set. A PropertyManager may
   operate only within the AccountAdmin-authorized set and current Property
   access; operating a feature never expands authorization.
4. Disable fences new and in-flight work immediately and hides outputs. Erasure
   purges local derivatives within the policy window while retaining only
   content-free evidence. Re-enable reuses an output only when every lineage,
   policy, model, authorization, and freshness fence still matches.
5. Provider output is advisory. It cannot mutate Inbox status/assignment/
   escalation, publish a Reply, change Portal behavior, alter a Goal/Metric/
   Recognition result, or trigger workforce decisions.
6. Reply Drafting is never cached as a generic suggestion detached from the
   Review revision or Brand Profile version. Its operation pins the display-name
   digest; admission and settlement transactionally revalidate Portal's boolean
   currentness authority. A manager must explicitly request it, may edit it, and
   must separately adopt, then Confirm & Publish through the Reply workflow.
7. Review Analysis enrollment is exhaustive for the authorized eligible source
   population; internal batching controls work size but never becomes a product
   cap or silently drops older Reviews.
8. Property Trends use the agreed minimum completed coverage and readiness
   semantics. Missing, incomplete, stale, or sequence-gapped data returns
   `preparing`/unavailable evidence rather than zero or a fabricated trend.
9. No source content or credential is stored in Redis, queues, events, telemetry,
   operation identifiers, or subject references. Durable facts are identifier-
   only and protected subjects use audience-separated HMAC references.
10. Provider work is cell-local and permit-bound. A provider outage, denied
    route, quota ambiguity, Redis/control outage, or authorization uncertainty
    fails closed without direct-network fallback.

## Events produced

| Event tag                                | Purpose                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `ai.review_analysis.backfill_requested`  | Request one freshly sequenced, identifier-only Review Analysis admission |
| `ai.property_trend.generation_requested` | Request deterministic reconciliation for one governed Property schedule  |

Both events use the shared identifier-only envelope and are exported through
`application/public-api.ts`.

## Public API

`application/public-api.ts` is the only cross-context interface. It exposes
presentation-facing aggregate shapes, on-demand Reply Drafting inputs/results,
the current Property Trend read model, and identifier-only event types.
Provider adapters, persistence, constructors, jobs, admission controls, error
guards, and source-content ports remain internal to the context and composition
root.

## Durable facts and jobs

- `identity.merchant_ai.changed` is the identifier-only authorization lifecycle
  trigger. Its durable AI consumer compares the complete authorization/source
  fence and commits, in one transaction, the current local-derivative visibility,
  any prior generation's content-free erasure obligation, Review Analysis
  enrollment/supersession, and the consumer receipt. Enable, capability change,
  disable, revoke, stale delivery, and exact replay all use this one command.
- A Property with no Reviews has an explicit analysis head at sequence `0`.
  That row is a serialized source frontier, not synthetic analysis work. Empty
  enrollment and caught-up populations use the canonical SHA-256 empty-set
  digest; any other zero-count digest fails closed.
- Enrollment retains separate snapshot and caught-up evidence. Both digests are
  content-free and cover the deterministic `(Review id, Material Review
Revision, analysis sequence)` set. Replay recovery skips a membership whose
  material revision changed; the newer revision remains live-event work and is
  never substituted into the immutable snapshot.
- The enrollment safety ceiling is a pause, not a population limit. A snapshot
  above 10,000 eligible revisions retains every immutable membership in
  `awaiting_assisted_approval`; no replay becomes actionable until the governed
  operator command records exact-fence, ticket-digest, operator, and correlation
  evidence. That command cannot change consent, select a subset, start work, or
  activate provider execution.
- `ai-review-analysis-enrollment-sweep` is the unconditional recovery seam for
  durable first-enablement intents. Every five-minute tick visits at most 50
  enrollment heads. A full batch waits for the next recurrence instead of
  enqueueing a continuation, so backlog cannot fan out queue work. The owning
  use case rechecks each exact authorization lineage, source epoch, capability
  epoch, and current global/provider/capability control triple before opening a
  replay; a dark runtime leaves the intent queued and logs content-free counts.
- `ai.review_analysis.backfill_requested` is an identifier-only request for one
  freshly sequenced analysis admission. It is not a replayed Review event.
- `ai.property_trend.generation_requested` asks the deterministic trend worker to
  reconcile one governed schedule.
- Outbox receipts, operation state, settlements, and output lineage are durable
  recovery authorities. BullMQ delivery and in-process callbacks are not.
- Property Trend scheduling/generation and Review Analysis backfill must be
  replayable, idempotent, bounded internally, observable, and repairable.

## Deterministic Property Trend definition

`property-trend-definition-v1` compares the latest 30 complete Property-local
calendar days with the immediately preceding 30 complete days. The current
partial local day is never included. Rating-only Reviews are reported as
`starOnlyCount` but are outside the text-analysis coverage denominator.

A window is ready only when it contains at least 20 successfully analyzed,
current-revision, text-bearing Reviews and those analyses cover at least 90% of
the eligible text-bearing candidate Reviews. Candidate, analyzed, excluded, and
star-only counts remain separate. Any unresolved Review-analysis sequence gap,
head/cursor mismatch, inaccessible source population, or correction not yet
reflected in the aggregate records `Updating`; it never manufactures a zero.

A notable signal requires an absolute share change of at least 15 percentage
points. Category signals additionally require the category to represent at
least 10% of analyzed Reviews in either comparison window. Selection and prose
are deterministic and provider-free. The durable result pins exact periods,
coverage, definition/render digests, Review Analysis profile/deployment/model
lineage, exact signal numerators/denominators, and content-free supporting Review
links. The numeric value exposed by the API is a change magnitude, never
confidence or statistical significance.

Readers keep showing the latest compatible complete result while a later head
is pending, paired with `Data through …` and `Updating`. They hide it when
authorization, source epoch, Property access/lifecycle, profile, or delivery
lease is no longer current. Schedule selection, final outcome commit, and read
delivery additionally require the exact current authorization generation's
Review Analysis enrollment to be `caught_up`; aligned live heads alone cannot
turn a partial first-enablement population into a complete trend. Scheduling is
bounded and idempotent over the exact terminal analysis sequence and aggregate
revision, so a correction creates a new schedule without overwriting the prior
complete result.

## Data and retention

- Source Review content remains owned and retained by Review; AI receives only an
  admitted, current snapshot for one operation.
- AI operations retain content-minimal execution/governance facts. Persisted
  Review Analysis, Property aggregate, and Property Trend generations follow
  authorization and source-content lifecycle fences and can be erased
  independently. Reply Draft provider output remains session-ephemeral; only an
  explicit, atomically revalidated adoption creates Review-owned draft content.
- A retired local derivative generation is hidden immediately by the current
  Identity authorization read fence. The AI lifecycle record starts a separate,
  exact 24-hour physical-erasure objective; serving never waits for that worker.
  The unconditional erasure worker claims one exact retired fence under a
  PostgreSQL lease, rechecks current Identity authority, deletes Review
  Analysis, Property aggregate, and Property Trend rows transactionally, and
  records class-separated counts. Eight persisted attempts, expired-lease
  recovery, a five-minute cadence, and the `ai.authorization_derivatives`
  retention evidence subject bound recovery and surface failures through the
  existing `retention.failure` alert. A fence that could match a currently
  served generation terminal-fails without deleting anything.
- New deterministic Property Trend outcomes expire after 24 calendar months;
  retention never overrides the immediate read-time authorization and lifecycle
  hiding rules.
- Raw provider requests/responses, prompts, private data, tokens, and unredacted
  errors are prohibited from database, Redis, job payload, log, and evidence
  artifacts.

## Organization Export contribution

`infrastructure/adapters/ai-organization-export.adapter.ts` implements the
Identity-owned `OrganizationExportContributor` port and is exposed on
`lifecycle.organizationExportContributor` — never on `publicApi`, so contributing
an export does not make any dark capability reachable. The contract permits this
context exactly one disclosure class, `retained_ai_derivative`.

It reads, from one bounded read-only repeatable-read snapshot, three derivative
classes — `ai_review_analyses`, `ai_property_daily_aggregates` and
`ai_property_trend_outcomes` (joined to `ai_property_trend_schedules` for its
fence) — and emits one CSV plus one lossless JSON per class. Selection is fenced
by exactly the predicates the serving read uses: `merchant_ai_enablement` must be
`enabled` and still carry the capability; lineage, capability epoch, source epoch
and start sequence must match; `ai_property_processing_profiles` must still be
`active` at the same profile and source epoch; `reviews` must agree on source
epoch, revision and analysis sequence with unexpired content; and the
derivative's own retention must not have lapsed. A retired generation is
therefore absent from the archive immediately, not after the 24-hour physical
erasure worker runs. `merchant_ai_enablement`, `ai_property_processing_profiles`
and `reviews` are read as fences only; no column of theirs is exported.

It deliberately withholds operation and monthly budget records, execution
controls, the enrollment authority, aggregate reconciliation ledgers,
session-ephemeral Reply Draft provider output, and all Google Review source
content. Every exclusion is enumerated in the emitted `excludedRecordClasses`.

An Organization that never authorized AI — or whose authorization is disabled or
revoked — contributes `no_data`, never an invented empty CSV.

## Organization lifecycle contribution

`infrastructure/adapters/ai-organization-lifecycle.adapter.ts` implements the
Identity-owned `OrganizationLifecycleContributor` port on the shared,
transaction-bound receipt store, and is exposed on
`lifecycle.organizationLifecycleContributor` — never on `publicApi`. Composing
it does not arm it: the coordinator that reaches `purge` is composed only under
an explicitly reviewed composition.

- **prepareClosing** stops AI work and deletes nothing. It supersedes every
  non-terminal `ai_review_analysis_enrollments` row with
  `terminal_reason = 'organization_closing'`. It deliberately does NOT retire
  `merchant_ai_enablement`: `guard_merchant_ai_enablement_v1` admits that head
  row only inside `apply_merchant_ai_transition_v1`, an Identity-owned
  SECURITY DEFINER authority that requires a live member with AI authority over
  the Property. Identity's contributor owns that transition.
- **verifyPurgeReadiness** is read-only and fails closed while the merchant
  authorization is still `enabled`, an enrollment is active, or an operation is
  still in flight.
- **purge** is irreversible, idempotent, and content-free. It deletes the
  retained derivatives together with aggregate heads and enrollments a later
  sweep could rebuild them from, so an erased
  derivative is not resurrectable. It keeps the append-only
  `merchant_ai_consent_evidence`, and leaves `merchant_ai_enablement` to the
  Property's schema cascade.

An Organization that never authorized AI answers `no_data` — affirmative
evidence, never an omitted contributor.

## Current implementation state

The context contains substantial control, admission, lifecycle, analysis,
drafting, aggregate, and schedule infrastructure. That does not mean every beta
capability is release-ready. The comprehensive program status ledger is the
completion authority; live provider/cell drills, full product-facing enrollment
progress, and deployed lifecycle/recovery evidence remain required until their
packages are evidence-complete.

`ops:ai-reanalyze --batch-size` is a ticketed operator pilot/repair control, not
the activation path for first-enablement completeness. The separate exhaustive
enrollment trigger, zero-review contract, revision-pinned recovery contract,
and fail-closed readiness read are implemented. Migration 0137 adds the durable
enrollment, immutable Material Review Revision membership, replay lineage,
revision-pinned backfill compatibility column, database guards, and upgrade
trigger replay. The upgrade migration also seeds the exact durable enrollment
snapshot under the same Property serialization lock, so rolling deployment does
not depend on a new consumer winning the event before an older worker. The
unconditional recurring enrollment sweep is registered, catalogued, and
scheduled through the shared operational authority; deployed scheduler/runtime
observation remains release evidence rather than a local-code claim. Migration
0156 makes the exact Material Review Revision a database-enforced analysis fact.
Migration 0157 adds the fixed whole-snapshot safety pause, assisted-approval
evidence, readiness counts, and `ops:ai-approve-enrollment`; a broader manager-
facing analyzed/candidate/excluded/failed and Verified Through surface remains a
product gap. Migration 0145 adds the single
AI-owned authorization lifecycle record and upgrade replay: local Review
Analysis, Property aggregate, and Property Trend generations are classified,
hidden by the current authorization fence, and given a content-free 24-hour
erasure deadline when retired. The physical erasure worker, deadline recovery/
alerting evidence, and class-separated aggregate/trend purge proof are now
implemented and fresh-PostgreSQL tested. Deployed scheduler/runtime
observations remain release evidence, not a local-code claim. Reply Draft
cross-context deletion proof, provider-side deletion evidence where applicable,
and deployed recovery evidence remain release gates.
