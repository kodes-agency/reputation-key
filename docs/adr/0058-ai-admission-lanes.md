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
| Global       | 8                 | 150              | 8                     | 16                   |
| Organization | 4                 | 120              | 4                     | 8                    |
| Property     | 3                 | 120              | 2                     | 8                    |

Rates are sliding one-minute windows. An in-flight slot is held until release
or a 90-second lease, which outlives the 70-second provider deadline. An
on-demand analysis must leave one interactive slot free (`headroom`), so
clicking through reviews cannot exhaust the lane drafts use.

The background lane is sized against the provider account, because drafts no
longer share it: the pinned model allows 500 requests and 500,000 tokens a
minute, and an analysis counts about 1,600 tokens against that (about 600 input
tokens plus the 1,024-token output ceiling the provider reserves). Both global
lanes together stay under half of either limit, which a unit test pins. A
property may use its organization's whole background budget, so one import runs
as fast as the account allows.

The table lives in `src/contexts/ai/domain/admission-lanes.ts`. Tuning changes
that file and this table together.

### Honest interactive answers

A reply draft waits up to four seconds for an interactive slot that frees in
time, and otherwise answers `busy` with the retry time. Provider and output
failures answer `unavailable`. The governed template is returned only when the
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
   first, and runs each entry through the ordinary analysis use case, eight at
   a time. Eight stays below the worker's ten-client database pool, which a
   unit test pins: an analysis holds a client only for one short transaction
   at a time, never across its provider call. It keeps claiming rounds while they settle work, for up to 20
   seconds, and one drain runs per worker at a time. A busy lane parks the
   property's remaining entries at the lane's retry time without asking again.
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
  about 11 minutes to 18 seconds.
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
