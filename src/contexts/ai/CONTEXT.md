# AI — Context

**Audience:** Developers and agents working in `src/contexts/ai/`.

## Responsibility

The AI context owns governed AI authorization reads, operation admission,
provider-inference orchestration, derivative output lineage/lifecycle, Review
Analysis enrollment, deterministic Property Trends, and on-demand Reply Drafting.
It does not own Google Review source content, Property access, Inbox workflow,
Reply publication, Portal/Guest data, metrics, goals, or notifications.

## Boundaries

- Cross-context and presentation-facing types/events are exported only through
  `application/public-api.ts`.
- `build.ts` is the composition-root boundary. Other contexts do not construct AI repositories, provider adapters, jobs, or control stores.
- Server functions are authenticated delivery adapters; they call the built
  `publicApi` and are not domain authority.
- Review supplies one admitted current source snapshot. Portal supplies only the
  exact public display name, profile version, digest, and boolean currentness.
- Lifecycle export and purge contributors are never on `publicApi`; composing one
  does not arm its irreversible phase.

## Model

The fixed beta capabilities are Review Analysis, on-demand editable Reply
Drafting, and deterministic Property Trends. Property Trends aggregate completed
Review Analysis and never make a second provider-generation call.

All three are dark until the AccountAdmin authorization, live access, notice version, provider policy, platform gate, runtime catalogue, and cell-local admission/egress controls agree. Property Trends additionally requires Review Analysis. A capability being present in code or schema is not activation.

Operations, settlements, derivative generations, enrollment heads, schedules,
and output lineage pin authorization, source, policy, model, and lifecycle fences.

## Runtime

Identity's merchant-AI fact drives one durable lifecycle command. The unconditional
five-minute enrollment sweep recovers first-enablement intent; outbox receipts and
operation state, not BullMQ delivery or in-process callbacks, are recovery
authority. Reply Draft provider output remains session-ephemeral until an explicit,
atomically revalidated adoption creates Review-owned draft content.

Property Trends compare the latest 30 complete Property-local days with the prior 30. Readiness requires at least 20 analyzed text Reviews, at least 90% coverage,
and a caught-up enrollment; incomplete settlement coverage reports
`preparing`/`Updating` rather than a fabricated zero.

## Invariants

1. AI processes only currently eligible Google Review content loaded through the Review public source port, the exact public Property display name loaded through Portal's narrow Brand authority, and—only for configured personalized drafts—sanitized Property-authored approved reply template bodies supplied by Review as style exemplars. Reply-profile framing and escalation contacts stay server-local. Brand image URLs, colors, localized Portal content, Private Portal ratings, feedback, contact details, Inbox notes, manager-internal text, and Guest media never enter AI admission, prompts, outputs, logs, or derived tables.
2. Every operation is fenced by Organization, Property, source epoch, source revision, authorization epoch, capability epoch, policy/profile versions, model/deployment, idempotency key, and lifecycle generation.
3. Authorization is a maximum allowed capability set. A PropertyManager may operate only within the AccountAdmin-authorized set and current Property access; operating a feature never expands authorization.
4. Disable fences new and in-flight work immediately and hides outputs. Erasure purges local derivatives within the policy window while retaining only content-free evidence. Re-enable reuses an output only when every lineage, policy, model, authorization, and freshness fence still matches.
5. Provider output is advisory. It cannot mutate Inbox status/assignment/escalation, publish a Reply, change Portal behavior, alter a Goal/Metric/Recognition result, or trigger workforce decisions.
6. Reply Drafting is never cached as a generic suggestion detached from the Review revision or Brand Profile version. A manager must explicitly request it, may edit it, and must separately adopt, then Confirm & Publish through the Reply workflow.
7. Review Analysis enrollment is exhaustive for the authorized eligible source population; internal batching controls work size but never becomes a product cap or silently drops older Reviews.
8. Missing, stale, or unreadable data returns `preparing`/unavailable evidence rather than zero. Coverage-incomplete Property insight aggregates may expose exact applied results only with an explicit provisional marker and coverage counts; period comparisons remain absent until both windows are complete.
9. No source content or credential is stored in Redis, queues, events, telemetry, operation identifiers, or subject references. Durable facts are identifier-only and protected subjects use audience-separated HMAC references.
10. Provider work is cell-local and permit-bound. A provider outage, denied route, quota ambiguity, Redis/control outage, or authorization uncertainty fails closed without direct-network fallback.
11. The enrollment safety ceiling is a pause, not a population limit. No replay becomes actionable until the governed operator command records exact-fence, ticket-digest, operator, and correlation evidence. That command cannot change consent, select a subset, start work, or activate provider execution.
12. Raw provider requests/responses, prompts, private data, tokens, and unredacted errors are prohibited from database, Redis, job payload, log, and evidence artifacts.

## Verification

Unit tests stay beside admission, lineage, lifecycle, enrollment, trend, drafting,
worker, server, and public-boundary subjects. PostgreSQL integration tests cover
transactional fences, replay, erasure, lifecycle, and export behavior.

The context contains substantial control, admission, lifecycle, analysis, drafting, aggregate, and schedule infrastructure. That does not mean every beta capability is release-ready. The comprehensive program status ledger is the completion authority; live provider/cell drills, full product-facing enrollment progress, and deployed lifecycle/recovery evidence remain required until their packages are evidence-complete.

The unconditional recurring enrollment sweep is registered, catalogued, and scheduled through the shared operational authority; deployed scheduler/runtime observation remains release evidence rather than a local-code claim. A broader manager-facing analyzed/candidate/excluded/failed and Verified Through surface remains a product gap. Deployed scheduler/runtime observations remain release evidence, not a local-code claim. Reply Draft cross-context deletion proof, provider-side deletion evidence where applicable, and deployed recovery evidence remain release gates.

`ops:ai-reanalyze --batch-size` is a ticketed operator pilot/repair control, not the activation path for first-enablement completeness. Migration 0157 adds the fixed whole-snapshot safety pause, assisted-approval evidence, readiness counts, and `ops:ai-approve-enrollment`; a broader manager-facing analyzed/candidate/excluded/failed and Verified Through surface remains a product gap.
