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
  `publicApi` and are not domain authority. Every read `publicApi` serves for a
  reader takes that reader's `AuthContext` and authorizes it for the Property
  itself (`application/ai-property-read-access.ts`: same Organization, the
  read's permission held, current Property access) before the
  merchant-authorization gate is read; a refusal is a tagged `AiError`
  `forbidden`. The permission is the one the read's surface is gated on:
  `dashboard.read` for `readPropertyAggregates`, `readPropertyInsights` and
  `readReviewAnalysisProgress`, `ai.trends.read` for `readPropertyTrend`, and
  `inbox.read` for `readReviewAnalysis`, which Inbox calls through its
  `AiReviewInsightsPort` after it has authorized the item.
- Not reader-authorized inside the context: the two review-id filters
  (`findCurrentReviewIdsByAttention`, `findCurrentReviewIdsByAspect`), which
  return identifiers only and which Inbox intersects with its own authorized
  item query; the Organization spend read; and the two commands
  (`generateReplySuggestion`, `requestReviewAnalysisNow`), whose only
  authorization is still their server function's execution-policy decision.
- Review supplies one admitted current source snapshot. Portal supplies only the
  exact public display name, profile version, digest, and boolean currentness.
- Lifecycle export and purge contributors are never on `publicApi`; composing one
  does not arm its irreversible phase.

## Model

The fixed beta capabilities are Review Analysis, on-demand editable Reply
Drafting, and deterministic Property Trends. Property Trends aggregate completed
Review Analysis and never make a second provider-generation call.

All three are dark until the AccountAdmin authorization, live access, notice version, provider policy, platform gate, runtime catalogue, and cell-local admission/egress controls agree. Property Trends additionally requires Review Analysis. A capability being present in code or schema is not activation.

An authorization recorded under a notice, or a provider deployment profile,
other than the one this build serves is refused before an operation is claimed
(`isAiAuthorizationUnderServedContract`, `application/ai-workflow-support.ts`).
A reply draft answers `consent_renewal_required`, which the composer shows as
the notice needing an AccountAdmin's confirmation. A review is settled as not
analysable, with no operation: re-consent bumps the Review Analysis epoch and
the enrollment replay analyses the history again. The gateway's request check
compares the same catalogue values and stays as the second line; it throws, so
it must never be the first.

Operations, settlements, derivative generations, enrollment heads, schedules,
and output lineage pin authorization, source, policy, model, and lifecycle fences.

## Source text

The text a model reads is made in two versioned stages. Review canonicalizes the
raw provider text and masks the reviewer's name (`ai-review-source-contract.ts`,
`ai-source-v1`); the gateway redacts that text at request time with the deployed
code (`gbp-review-global-v1` over `structured-marker-detectors-v1`, the second
with `ai-address-markers.ts`). Every operation binding records the canonicalizer
(`AI_SOURCE_CANONICALIZER_DIGEST_V1`), and the operation profile attests the
detectors and the redactor by digest, so a change to a rule moves a digest. Both
digests are recomputed from the code; no stored analysis, aggregate or Trend is
compared with them, so a bump hides nothing that was already produced. The one
exception is an operation still pending when the new build starts: its request
fingerprint includes the binding, so its next claim answers `conflict`, the
review is settled not analysable, and the reaper abandons the operation at its
expiry, after which the reopen pass queues the review again.

A change to these text rules is not an "analysis contract change" in the sense
of ADR 0031 (which bumps the capability epoch and re-analyses eligible history):
it changes what the next request sends, not the contract an analysis is stored
under, so it leaves the capability epoch alone and reaches only the reviews that
are analysed after it. If product wants the history analysed again under new
rules, the epoch bump is the lever (it moves with a Merchant AI authorization
transition, not a deploy); the options and their cost are listed in the pull
request that carried the change.

Changing what the canonicalizer produces is not a patch. The Review row stores a
digest and a byte length of the canonical text (`ai_source_digest`,
`ai_source_byte_length`), `readForAi` recomputes them from the raw row, and the
output store refuses a result whose operation digest differs from the Review's.
So a rule change needs a new text revision (`AI_SOURCE_TEXT_REVISION`) with:

1. the previous revision kept reproducible for one content lifetime (30 days,
   ADR 0031), only to recognise a digest stored under it;
2. `readForAi` serving a row under the revision its stored digest names
   (`matchStoredAiReviewSourceProvenance`), so no row turns `policy_unavailable`
   and the digests the AI context compares stay equal;
3. the Review sync treating a stored digest of the previous revision as
   unchanged (`aiSourceUnchanged`), so the row is rewritten quietly on its next
   observation instead of raising `review.updated`, a new analysis sequence and
   a manager notice for a review nobody changed;
4. a new `AI_SOURCE_CANONICALIZER_DIGEST_V1`, derived from the rules named in
   `ai-source-profile.test.ts`.

Revision 2 (2026-10-14) turns a line break or tab between two words into a space
(revision 1 deleted it and fused the words) and replaces Unicode noncharacters
with U+FFFD. Two things hold until a stored row is observed again (at most 25
days): the text it serves is revision 1's although an operation records the
current canonicalizer digest (the digest names the rules that produced the text
only after the next observation), and a row that holds a noncharacter fails
`encodeCanonicalAiReviewSource` where revision 1 let it through to the gateway
schema, which refused it later. A quiet rewrite that lands while a review's
analysis is executing makes the store refuse the result (`generation_changed`,
receipt `obsolete`) and opens no sequence; the reaper fails the abandoned
operation as `operation_ambiguous`, a code the reopen pass queues a review again
on. Two inputs are still not handled: a text of 16 KB or more after NFKC
and a lone surrogate. Either throws in the canonicalizer and fails the Property's
snapshot page, and whether such a review is skipped or truncated is a product
question.

Redactor and detector changes need none of this: they act on the next request and
change no stored value. A review the redactor blocked stays settled as not
analysable (`redaction_blocked` is not a reopen code, `review-analysis-reopen.ts`)
until something gives it a new analysis sequence.

The address detector (`ai-address-markers.ts`) takes a house number, a street
name and a street-type word, in two layouts: name first (`25 Main Street`,
`7 oak lane`, `12 de la Rosa Street`) and street first, capitalised
(`100 Boulevard Saint-Germain`, `8 Place de la Concorde`). It does not take, and
`ai-redaction-ordinary-prose.test.ts` pins this, a street written after its
number (`Main Street 25`), Bulgarian street words (`ул.`, `бул.`), a street word
with no English type word (`rue`), or a street-first layout typed in lower case.
It also reads a word glued to a full stop (`hotel.Staff`, `Dr.Smith`) as a
domain, because nothing separates it from `example.Com`. Taking any of these is a
change to the detectors' digest and a decision, not a patch.

## Runtime

Identity's merchant-AI fact drives one durable lifecycle command, which opens a
freshly queued enrollment's replay on delivery. The unconditional one-minute
enrollment sweep recovers first-enablement intent; outbox receipts and
operation state, not BullMQ delivery or in-process callbacks, are recovery
authority.

Provider calls are admitted once per lane before an execution attempt is
claimed (ADR 0058): interactive work (reply drafts, on-demand analysis) and
background work (history) have independent global, organization and property
buckets. Historical and backfill analysis events queue their provider work in
`ai_review_analysis_backlog`, which a 5-second drain empties newest review
first, eight analyses at a time, and records an enrollment caught up as soon as
its last review settles; a review opened in the Inbox is analysed ahead of the
queue. The drain's schedule is tenant-cross, so it asks current platform policy
about each claimed entry's own Organization and Property before analysing it
(ADR 0032): an entry refused by the kill switch, a suspension or the allowlist
goes back to the queue untried, with no attempt counted and nothing settled,
and is analysed once the stop is lifted. A review that arrives during a stop
waits in the backlog as well (ADR 0058, 2026-10-13). The analysis consumer's
catalogue row is ungated, because a refused consumer is never retried: before
it analyses an ongoing review on delivery it asks the drain's policy question,
and a review policy refuses is queued after the checks that need no provider
call. A stopped AI execution control (killed or draining at the global,
provider or capability scope, or a missing head) is answered `stopped`, never
settled: the consumer queues the review, and the drain and the on-demand job
return it untried until the control accepts work again. A review that was
tried before such a stop cannot resume its operation, which is bound to the
control generations it was claimed under: after the restore its claim answers
`conflict`, the analysis closes that pending operation as `execution_suspended`
and settles the review against it, and the reopen pass queues it again
(`application/analysis-claim-conflict.ts`). The sweep also reopens a text
review whose analysis settled without a result because its operation gave up
on a transient failure (ADR 0058, 2026-09-29): a fresh analysis sequence and a
backfill event, at most three times per revision. An enrollment is not caught
up while one of its replayed reviews still owes an analysis. The replay and the
reopen pass lock the Property's source fence before their enrollment row and
reviews, the order Review writers and authorization changes take (ADR 0060).
`readReviewAnalysisProgress` reports queued, running, analysed and
not-analysable counts. Reply Draft provider output remains session-ephemeral until an explicit,
atomically revalidated adoption creates Review-owned draft content.

Property Trends compare the latest 30 complete Property-local days with the prior 30. Readiness requires at least 20 analyzed text Reviews, at least 90% coverage,
and a caught-up enrollment; incomplete settlement coverage reports
`preparing`/`Updating` rather than a fabricated zero.

## Invariants

1. AI processes only currently eligible Google Review content loaded through the Review public source port plus the exact public Property display name loaded through Portal's narrow Brand authority. Brand image URLs, colors, localized content, Private Portal ratings, feedback, contact details, Inbox notes, manager-internal text, and Guest media never enter AI admission, prompts, outputs, logs, or derived tables.
2. Every operation is fenced by Organization, Property, source epoch, source revision, authorization epoch, capability epoch, policy/profile versions, model/deployment, idempotency key, and lifecycle generation.
3. Authorization is a maximum allowed capability set. A PropertyManager may operate only within the AccountAdmin-authorized set and current Property access; operating a feature never expands authorization.
4. Disable fences new and in-flight work immediately and hides outputs. Erasure purges local derivatives within the policy window while retaining only content-free evidence. Re-enable reuses an output only when every lineage, policy, model, authorization, and freshness fence still matches. An adopted Reply draft is Review-owned, so the control, Authorization and profile transitions withdraw the unedited ones in their own transaction through the AI draft purge (`src/shared/db/ai/ai-draft-purge.ts`; the rule is in the Review context's Model): a Reply nobody confirmed is deleted, and a confirmed one that has not been dispatched is cancelled and emptied while its publication authorization stays as evidence. A Reply whose publication already failed keeps its text, and Review's publish claim withdraws it the same way when a manager tries it again: having been claimed once excuses the ten-minute adoption window, never a changed input.
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
transactional fences, replay, erasure, lifecycle, and export behavior, and which
Properties the Property Trend scheduler picks and whose outcome it still accepts
(`ai-property-trend-schedule-store.adapter.integration.test.ts`).

The context contains substantial control, admission, lifecycle, analysis, drafting, aggregate, and schedule infrastructure. That does not mean every beta capability is release-ready. The comprehensive program status ledger is the completion authority; live provider/cell drills, full product-facing enrollment progress, and deployed lifecycle/recovery evidence remain required until their packages are evidence-complete.

The unconditional recurring enrollment sweep is registered, catalogued, and scheduled through the shared operational authority; deployed scheduler/runtime observation remains release evidence rather than a local-code claim. A broader manager-facing analyzed/candidate/excluded/failed and Verified Through surface remains a product gap. Deployed scheduler/runtime observations remain release evidence, not a local-code claim. Reply Draft cross-context deletion proof, provider-side deletion evidence where applicable, and deployed recovery evidence remain release gates.

The first-enablement Review Analysis enrollment replay and the sweep's reopen pass are the only producers of `ai.review_analysis.backfill_requested`; a reopened review's event is correlated to the operation it replaces, never to an enrollment. Migration 0157 adds the fixed whole-snapshot safety pause, assisted-approval evidence, readiness counts, and `ops:ai-approve-enrollment`; a broader manager-facing analyzed/candidate/excluded/failed and Verified Through surface remains a product gap.
