---
status: accepted
date: 2026-09-15
---

# 0058 — AI admission lanes and paced review analysis

## Context

On 2026-09-14 a property with 96 Google reviews was imported and AI was enabled
for it. Every historical review became an immediate Review Analysis call. A
manager who opened the Inbox straight away and asked for a reply draft was
given a local template instead, for about fifteen minutes.

The cause was admission, not the provider. Review analysis and interactive
reply drafting shared one budget: a gateway rate limiter with four scopes
(`global` 16, a literal `provider` key 16, organization 8, property 4 per
minute). The scopes were checked one after another, each with an increment
before its comparison, so a refusal at the property scope had already spent
global and organization capacity. The check ran inside the gateway after the
operation's execution attempt was claimed, so every refusal also burned an
attempt. The refusal was then renamed `provider_rate_limited`, which the reply
use case treated as a provider failure and answered with a template. A second,
atomic, per-capability quota adapter ran in front of it with different numbers.
None of this was written down.

## Decision

### One atomic admission, before the attempt

1. Every provider-bound AI call is admitted exactly once, by the AI context,
   before `claimExecution`. A refused admission is never an execution attempt.
2. Admission is one Redis script over three scopes — global, organization and
   property — in one lane. It admits only when every scope has room and then
   records the admission in all of them. A refusal writes nothing and returns
   the earliest time capacity frees (`admission_busy`, `retryAfterEpochMillis`).
   An unavailable store fails closed (`admission_unavailable`).
3. The gateway keeps the kill switch and the organization's monthly cost
   reservation. It no longer rate-limits, and no internal refusal is ever
   reported as `provider_rate_limited`; that code means the provider's own 429.

### Two lanes

Interactive work is a manager waiting: reply drafting, and an analysis
requested for the review on screen. Background work is Review Analysis history.
Every scope has an independent bucket per lane, so a backlog can never consume
the capacity a draft needs.

| Scope        | Interactive / min | Background / min | Interactive in flight | Background in flight |
| ------------ | ----------------- | ---------------- | --------------------- | -------------------- |
| Global       | 24                | 125              | 8                     | 24                   |
| Organization | 12                | 120              | 4                     | 16                   |
| Property     | 6                 | 120              | 2                     | 16                   |

Rates are sliding one-minute windows. An in-flight slot is held until release
or a 90-second lease, which outlives the 70-second provider deadline. An
on-demand analysis must leave one interactive slot free (`headroom`), so
clicking through reviews cannot exhaust the lane drafts use.

The background lane is sized against the provider account, because drafts no
longer share it: the pinned model (`gpt-6-luna`) allows 5,000 requests and
2,000,000 tokens a minute, and a v3 analysis counts about 7,900 tokens against
that (about 3,800 input tokens plus the 4,096-token output ceiling the provider
reserves). The background lane alone stays under half of the token limit, and
both global lanes together stay under half of the request limit and under 60% of
the token limit, counting a draft at about 7,000 tokens. A unit test pins all
three. A property may use its organization's whole background budget, so one
import runs as fast as the account allows. How fast history runs is set by the
in-flight column, not the rates (amendment 2026-10-30).

The interactive rates are sized against a manager (amendment 2026-11-01). A draft
takes about ten seconds, so Draft, Shorter, Tone and Try again straight through
ask for six a minute at one property. At 3 a minute a manager retrying one review
read that "other requests" were busy when the only requests were their own.

The table lives in `src/contexts/ai/domain/admission-lanes.ts`. Tuning changes
that file and this table together.

Background reply drafts (v2, registered dark) also use the background lane.
Because intent is client-asserted and this capacity is shared with the analysis
backlog, each provider call, including a rewrite, must additionally fit sliding
one-minute caps of 6 drafts per actor and 30 per Organization. Redis checks and
records these caps atomically with ordinary lane admission; a denial consumes
no capacity and returns quiet `deferred` without a provider call. Explicit
requests retain their existing interactive admission.

### Honest interactive answers

A reply draft waits up to four seconds for an interactive slot that frees in
time, and otherwise answers `busy` with the retry time. Provider and output
failures answer `unavailable`, including a draft whose automatic rewrite finds the
lane full: it has already failed, so a full lane is not the answer to give. The governed template is returned only when the
manager asks for it or the language has no personalized drafting profile. The
composer keeps one idempotency key per compose session, tone and target: a busy
retry and a repeated click reuse it, and any finished answer rotates it.

### Paced history

1. History does not fan out. A first-enablement backfill event, and a
   `review.created` or `review.updated` observed as `historical_onboarding`,
   runs every check that needs no provider call and then queues its provider
   work in `ai_review_analysis_backlog`. A live review whose background lane is
   busy is queued the same way. The origin event is receipted when its row is
   written; the row is the durable authority for the remaining work.
2. A recurring drain (every 5 seconds, background queue) claims rounds of at
   most the property background in-flight share per property, newest review
   first, and runs each entry through the ordinary analysis use case, sixteen
   at a time (an organization's background in-flight share). The worker's
   database pool is sized to cover that concurrency (`src/worker/pool-budget.ts`,
   ADR 0060), which a unit test pins: an analysis holds a client only for one
   short transaction at a time, never across its provider call. It keeps
   claiming rounds while they settle work, for up to 20 seconds, and one drain
   runs per worker at a time. A busy lane parks the property's remaining
   entries at the lane's retry time without asking again.
   Any settled outcome deletes the entry. A claim expires after three minutes.
   The operation horizon of a drained entry starts when the drain first takes
   it, not when the review was imported.
3. The enrollment consumer opens a freshly queued first-enablement replay on
   delivery, and the drain records a Property's enrollment caught up as soon
   as its last replayed review settles. The enrollment sweep, every minute,
   stays the recovery path for both.
4. A review opened in the Inbox for 1.5 seconds with analysis still waiting is
   handed to an on-demand worker job, which analyses it ahead of the queue on
   the interactive lane with headroom. A busy lane leaves it queued with
   interactive priority, so the next drain takes it first.
5. `readReviewAnalysisProgress` reports queued, running, analysed and
   not-analysable counts and the enrollment's verified-through time.

## Consequences

- An import's history starts analysing within seconds of AI being switched on
  and runs at up to 120 reviews a minute per property. The newest reviews,
  the ones a manager is likeliest to answer, come first, and the one on screen
  is analysed within seconds.
- Admission refusals are cheap and harmless, so callers may ask again at the
  retry time without amplifying load.
- The backlog table is identifier-only operational state. It cascades with its
  property or review, is deleted by organization purge, and is classified as
  active authority in the data fate catalogue.
- A Redis outage stops all AI admission. That is unchanged: admission fails
  closed.

## Amendments

- **2026-09-28** — Sized the background lane to the provider account. The
  first budgets (background 12 / 6 / 3 a minute, property in flight 2)
  protected drafts that the lanes had already separated, so history crawled:
  a two-property import of 22 reviews showed "Analysing" for 11 minutes,
  although its provider calls took about 2.5 seconds each. The time went to the
  five-minute enrollment sweep before the replay opened, the 30-second drain
  tick, three admissions a minute per property with one-at-a-time draining,
  and the sweep again before the enrollment was recorded caught up. The
  background lane now admits 150 / 120 / 120 a minute (organization and
  property in flight 8, global 16), the drain runs every 5 seconds in parallel
  rounds of eight, the enrollment opens on delivery and closes when its last
  review settles, and the sweep runs every minute as recovery. Measured on the
  first step of this change (4 at a time, 60 a minute): 18 reviews went from
  about 11 minutes to 18 seconds. The background rate and in-flight numbers
  here, and the rounds of eight, were resized on 2026-10-30 (below).
- **2026-09-29** — Reopening an abandoned analysis. An import burst on the
  closed beta (244 reviews in 30 seconds) left three text reviews of one
  Property permanently unanalysed while its enrollment recorded itself caught
  up. Database lock waits of 10–30 seconds cost three analyses so much of their
  70-second deadline that the gateway withheld dispatch (`grant_ttl_too_short`)
  and released their grants at zero cost. The admission authority then refused
  every later attempt of those operations as `already_consumed`, because an
  operation kept its first attempt's nonce and binding for good; the gateway
  reported the refusal as `operation_ambiguous`, which spends the four provider
  attempts, and after the fourth each review was settled without a result.
  Settling counted as caught up, and nothing looked at the reviews again.
  Separately, an admission authority that timed out was also reported as
  `operation_ambiguous`, though nothing had been granted or dispatched.
  1. At the source: an operation's next attempt is admitted afresh when its
     previous admission was released without charge (a withheld dispatch, or a
     stale reservation the reaper released); a charged or still-open admission
     still blocks it, since the ledger holds one reservation per operation. An
     admission authority that cannot answer is `provider_unavailable`, retried
     within the operation horizon without spending provider attempts.
  2. The safety net: the enrollment sweep reopens text reviews whose current
     analysis settled without a result because its operation failed with a
     code that says nothing about the review (`AI_REVIEW_ANALYSIS_REOPEN_CODES`
     in `src/contexts/ai/domain/review-analysis-reopen.ts`: ambiguous,
     abandoned, undelivered, provider or budget unavailable). Each gets a fresh
     analysis sequence and an `ai.review_analysis.backfill_requested` event
     correlated to the abandoned operation, and is queued again through the
     ordinary path. A revision is reopened at most three times; reviews that
     exhaust it are counted on every sweep (`analysesLeftUnanalysed`). Answers
     about the review itself — the redactor, its language, its size, the
     provider's refusal or invalid output — are never reopened. The pass runs
     only while provider execution accepts work, 50 reviews per tick.
  3. A first-enablement enrollment catches up only when none of its replayed
     reviews still owes an analysis: its current sequence must have settled,
     and not after an abandoned or still-open operation.
- **2026-10-12** — The drain decides each entry under current platform policy.
  The drain's schedule is tenant-cross, and the delayed policy admits a
  tenant-cross firing before any capability check, because the firing names no
  Organization (ADR 0032, ADR 0033). The drain then ran every claimed entry
  through the analysis use case, which checks the merchant's authorization and
  the AI control heads and nothing else. So `BETA_CAPABILITIES_OFF=ai.analyze`
  (or `all`), a suspended Organization, or an Organization taken off the
  allowlist stopped new review events at the consumer while the reviews already
  queued kept going to the provider until the backlog was empty.
  1. The worker hands the drain a scope authorizer for its own action, and the
     drain asks it about each claimed entry's Organization and Property before
     the analysis use case is called. The on-demand job is Property-scoped, so
     the dispatch gate already decides it.
  2. A refused entry is returned to the queue untried (`release`): no attempt
     is counted, nothing is settled, its first start is cleared so the
     operation horizon begins when a drain next takes it, and it is asked about
     again after a minute. It is analysed once the stop is lifted. The drain
     reports the count as `denied`. That is exact for an entry no drain had
     tried before the stop. One that had been tried keeps its pending
     operation, whose 24-hour window from its first claim does not pause: in a
     longer stop the execution reaper, which holds no capability, abandons it
     and settles the review `operation_abandoned`, and the review is then owed
     to the reopen pass (2026-09-29), not to this entry. A reopen raised while
     the stop still holds is refused at the gated consumer, like any review
     event that arrives during a stop.
  3. A refused Property still takes one of a round's three Property slots when
     the claim picks it, and its entries go back untried. Other Properties keep
     draining; with many refused Properties holding large backlogs they are
     picked less often. The follow-up is to park every ready entry of a
     refused Organization and Property in one statement, so that a refused
     Property costs one slot a minute.
- **2026-10-13** — A review that arrives during a stop waits in the backlog.
  The 2026-10-12 amendment made queued reviews wait out a platform stop and
  left the review that arrives during one lost: policy refused the analysis
  consumer at the dispatcher, a refused consumer gets an obsolete receipt and
  is never retried, and nothing analysed the review once the stop was lifted. A
  stop through the AI execution controls lost arrivals another way: the
  analysis use case settled the review `policy_disabled` with no operation, and
  the reopen pass selects by a failed operation, so a restore re-admitted
  nothing. A queued entry drained during such a stop was settled the same way.
  1. A stopped AI execution control is an answer, not a settlement. When a
     review needs a provider call and the global, provider or capability
     control does not accept work, or a control head is missing, the analysis
     use case answers `stopped` and writes nothing. What needs no provider call
     is still settled first: a source transition, a merchant who switched AI
     off, a review without text, an unsupported language.
  2. The consumer queues a stopped review under its origin and receipts the
     event. The drain returns an entry whose analysis answers `stopped` with
     `release`, as it returns a refused one: no attempt counted, nothing
     settled, its first start cleared, asked again after a minute. It reports
     the count as `stopped`. The on-demand job leaves the entry queued the same
     way. Once the control accepts work again, an entry no drain had tried is
     analysed by the drain; one that was tried before the stop is item 7.
  3. The analysis consumer's catalogue row is ungated, like the enrollment
     consumer's, so policy no longer refuses it at the dispatcher. It never
     analyses a stopped Organization's review on delivery: before an ongoing
     review's provider call it asks current policy about the review's
     Organization and Property, with the scope authorizer of the drain's own
     action, and a refused review runs only the checks that need no provider
     call and is queued. Provider work stays gated on `ai.analyze` at the drain,
     for each entry, and at the on-demand job, by the dispatch gate. A consumer
     that was given no authorizer analyses nothing on delivery and queues every
     review.
  4. A source transition is settled under a platform stop too. It needs no
     authorization, profile or provider call, and exact coverage counts its
     sequence. Under the gated row a platform stop obsoleted it and its
     sequence was never settled.
  5. Nothing bounds the wait. A review held by either stop is analysed when the
     stop lifts, however long that is, and an Organization taken off the
     allowlist for good keeps the new reviews of its AI-enabled Properties
     queued. A Property that never enabled AI queues nothing. While reviews
     wait, the Property's coverage is incomplete: its insights carry the
     provisional marker, and `ai.review-analysis-stalled` fires after fifteen
     minutes without a settlement and clears once the stop is lifted
     (runbooks §22).
  6. This supersedes the last sentence of item 2 of 2026-10-12: a reopen raised
     while a stop holds is queued and waits like any other review. The
     operation window of that item is unchanged, and runs for an entry held by
     a stopped control as well: in a stop longer than 24 hours the reaper
     abandons a tried entry's pending operation and the review is owed to the
     reopen pass.
  7. An entry that was tried before an AI control stop cannot resume its
     operation, however short the stop. A full lane or a provider's "later" is
     enough to claim an operation, and it is claimed under the control
     generations of that moment. Every kill, drain and restore moves a
     generation and the request fingerprint covers them, so after the restore
     the claim under the same event answers `conflict`. The store hands the
     recorded operation back with that answer, and the analysis recognises its
     own request by fingerprinting it under that operation's stop fence
     (`isSameAiRequestUnderOtherControls`). It closes the pending operation as
     `execution_suspended`, a reopen code, and settles the review against it;
     the drain then removes the entry, and the reopen pass (2026-09-29, once a
     minute) queues the review again under a fresh sequence and a fresh
     operation. So such a review is analysed a few minutes after the restore,
     not when the reaper would have abandoned the stale operation at its
     24-hour expiry, and it spends one of the revision's three reopens. A
     conflict that differs in anything else is settled as not analysable as
     before, and an operation that is executing or finished is left to its
     owner.
- **2026-10-22** — Coverage never waits for a number nobody holds (migration
  0068). Every analysis sequence after the authorization's start, up to the
  review head, is owed a settlement; the stall alert, the aggregate read, the
  trend scheduler and the trend report all compare the settlements with
  `head_sequence - analysis_start_sequence`. The Review writer
  (`upsertAndRecord`) took the next sequence before persisting the
  observation, because allocating takes the Property row lock and the repo
  locks the Property first (ADR 0060). When the observation then turned out to
  be a replay (the same observation key) or older than the stored Google
  version, it returned without stamping a Review or writing an event, and the
  transaction committed with the head one higher. On the beta, between
  2026-10-20 15:16 and 17:58 UTC (a window of retried snapshot pages) four
  numbers of the largest Property, 3971 to 3974, were lost this way: no Review
  and no outbox fact held them, and `ai.review-analysis-stalled` fired until
  they were recorded. The allocation stays where it is. The writer now records
  an unused number in `review_ai_analysis_released_sequences` (organization,
  property, source epoch, sequence, reason `replayed_observation`,
  `out_of_order_observation` or `operator_repair`, instant) in the same
  transaction, and coverage subtracts the released numbers that lie in
  (`analysis_start_sequence`, `head_sequence`] of the same source epoch and are
  not also settled (a number that is both counts once, as the settlement).
  The ledger lives and dies with the head: cascade with the Property, deleted
  by the Review Organization purge, not exported. The other allocation paths
  (the AI reopen and enrollment replay passes, a source transition, a lifecycle
  expiry and a re-observation of an expired Review) either stamp the number on
  a Review and announce it in the same transaction, or throw and roll the
  allocation back, so they need no release. There is no automatic sweep: the
  alert remains the signal for any future leak, and
  `pnpm ops ai release-orphan-sequences <propertyId>` records the numbers a
  past leak left (no settlement, no Review holding it, no outbox fact naming
  it, not released; refused while the head moved in the last 15 minutes). The
  runbook is §22.
- **2026-10-25** — A provider refusal is named, and an operator can reopen past
  the budget. From 2026-10-24 01:18 UTC the OpenAI account had no credit left
  and answered every call 429 for about 40 hours. Every analysis on the beta
  failed as `operation_ambiguous`, and ten text reviews used their three reopens
  and stayed unanalysed after the balance was topped up. Two causes:
  1. The connector reported a complete non-200 answer as unknown usage. For
     unknown usage the gateway expects the reserved maximum
     (`expectedSettlementCostMicros`), while the admission authority charges
     priced usage, which is zero here. No such receipt bound, so every 429 and
     5xx reached the caller as `operation_ambiguous`, not
     `provider_rate_limited` or `provider_unavailable`. A 429 or a 500, 502,
     503 or 504 bills nothing, so the connector now reports its usage as known:
     zero. The authority keeps charging it nothing. That matters: the ledger
     holds one reservation per operation, and only an admission settled at
     zero lets the next attempt in (item 1 of 2026-09-29). Every other status
     keeps unknown usage and stays `operation_ambiguous`, as before. A 400 or
     a 401 after a key or parameter change is a fault that is not the review's,
     so it must stay reopenable and spend the attempt budget; it must not
     retry unbudgeted as `provider_unavailable` or settle for good as
     `provider_refused`. Unknown usage (a timeout, a lost connection) still does
     not bind either.
  2. A 429 whose body says `insufficient_quota` (in `error.type` or
     `error.code`) is the provider disposition `quota_exhausted`, not
     `rate_limited`. It is not retryable, and the gateway answers
     `quota_exhausted`, the code the budget refusal already used. It is a
     reopen code and spends provider attempts, so an empty balance still ends
     in reviews that have used every reopen. Recovery is
     `pnpm ops ai-reopen-analyses <propertyId|all>`: it lists the reviews whose
     reopens are spent and, with `--reason --apply`, reopens them through the
     same path as the sweep, 50 per transaction. Like the sweep, it refuses
     while an AI execution stop is in force. A Property that fails is printed
     and the run goes on. The budget still counts their failures, so one that
     fails again waits for the next operator run. Runbook §22.
- **2026-10-30** — Sized to the limits of the current model. History on the
  closed beta ran at about 45 to 60 analyses a minute, although the background
  lane admits 120 a minute per property. The budgets of 2026-09-28 were sized
  for the old model: an account of 500 requests and 500,000 tokens a minute,
  and an analysis that counted about 1,600 tokens.
  1. What was measured, on 2026-10-30. The beta key on `gpt-6-luna` (deployment
     profile `private-beta-global-v2`) reads 5,000 requests and 2,000,000
     tokens a minute from the `x-ratelimit-limit-requests` and
     `x-ratelimit-limit-tokens` headers. A v3 analysis sends about 3,800 input
     tokens (the quality check of 424 synthetic reviews sent 1,599,608, or
     3,773 each) and its output ceiling is 4,096 tokens. The provider counts
     the ceiling when the request arrives, so one analysis counts about 7,900
     tokens, five times the 1,600 the table was sized for. On the beta an
     analysis takes 4.8 seconds at the median and 9.3 seconds at the 90th
     percentile, end to end, and with 8 in flight history ran 45 to 60 a
     minute: a drain round claims at most 8 entries per property, runs them 8
     at a time and waits for its slowest call before it claims again.
  2. The new table. The global background rate goes from 150 to 125.
     Background in flight goes from 16 to 24 globally, from 8 to 16 per
     organization and from 8 to 16 per property. The organization and property
     rates (120) and every interactive value are unchanged.
  3. Why the global rate went down while in flight went up. A v3 analysis is a
     bigger request, so half of the account's tokens (1,000,000 of 2,000,000 a
     minute) pays for 126 analyses a minute, where 150 had been sized against
     half of 500,000 tokens at 1,600 each. The rate was never the limit: at 4.8
     to 9.3 seconds a call, 8 in flight could not reach 120 a minute, so in
     flight held history back. 125 is the round number under 126. In-flight
     shares of 16 let one property reach its rate; the global 24 leaves the
     rest of the lane to reviews analysed on delivery.
  4. What follows without a change to the drain's formulas. The drain runs as
     many analyses at once as an organization may have in flight, now 16, and
     a round claims at most the property's share for up to three properties,
     now 48 entries. The worker's database pool is budgeted from the drain, so
     it grows from 49 to 57 connections (ADR 0060). The unit test of the rule
     that both global lanes stay under half of the account limits now takes the
     analysis that runs: the v3 profile's output ceiling plus 3,800 measured
     input tokens, or v2's, whichever is larger.
  5. Expected effect. With several properties waiting, a round claims up to
     three properties' shares and the drain keeps 16 calls in flight, so the
     organization and global rates bind: about 100 to 125 analyses a minute,
     and a full replay of the beta's history (about 14,000 reviews) takes about
     2 hours where it took 4 to 5. One property alone gains less, because its
     round claims only its own 16 and waits for the slowest call: about 70 to
     80 a minute, from 45 to 60. These are what the table should give; neither
     has been measured at the new setting.
