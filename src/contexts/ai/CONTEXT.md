# AI context

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
   Review public source port. Private Portal ratings, feedback, contact details,
   Inbox notes, manager-internal text, and Guest media never enter AI admission,
   prompts, outputs, logs, or derived tables.
2. Every operation is fenced by Organization, Property, Data Cell/source epoch,
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
   Review revision. A manager must explicitly request it, may edit it, and must
   separately Confirm & Publish through the Reply workflow.
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

## Durable facts and jobs

- `ai.review_analysis.backfill_requested` is an identifier-only request for one
  freshly sequenced analysis admission. It is not a replayed Review event.
- `ai.property_trend.generation_requested` asks the deterministic trend worker to
  reconcile one governed schedule.
- Outbox receipts, operation state, settlements, and output lineage are durable
  recovery authorities. BullMQ delivery and in-process callbacks are not.
- Property Trend scheduling/generation and Review Analysis backfill must be
  replayable, idempotent, bounded internally, observable, and repairable.

## Data and retention

- Source Review content remains owned and retained by Review; AI receives only an
  admitted, current snapshot for one operation.
- AI operations retain content-minimal execution/governance facts. Derivative
  Review Analysis, Reply Draft, aggregate, and trend outputs follow authorization
  and source-content lifecycle fences and can be erased independently.
- Raw provider requests/responses, prompts, private data, tokens, and unredacted
  errors are prohibited from database, Redis, job payload, log, and evidence
  artifacts.

## Current implementation state

The context contains substantial control, admission, lifecycle, analysis,
drafting, aggregate, and schedule infrastructure. That does not mean every beta
capability is release-ready. The comprehensive program status ledger is the
completion authority; live provider/cell drills, exhaustive enrollment,
material-revision integration, and full lifecycle/recovery evidence remain
required until their packages are evidence-complete.
