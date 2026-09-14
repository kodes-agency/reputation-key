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
| Global       | 8                 | 12               | 8                     | 12                   |
| Organization | 4                 | 6                | 4                     | 4                    |
| Property     | 3                 | 3                | 2                     | 2                    |

Rates are sliding one-minute windows. An in-flight slot is held until release
or a 90-second lease, which outlives the 70-second provider deadline. An
on-demand analysis must leave one interactive slot free (`headroom`), so
clicking through reviews cannot exhaust the lane drafts use.

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
2. A recurring drain (every 30 seconds, background queue) claims at most the
   property background rate per property, newest review first, and runs each
   entry through the ordinary analysis use case. A busy lane parks the
   property's remaining share at the lane's retry time without asking again.
   Any settled outcome deletes the entry. A claim expires after three minutes.
   The operation horizon of a drained entry starts when the drain first takes
   it, not when the review was imported.
3. A review opened in the Inbox for 1.5 seconds with analysis still waiting is
   handed to an on-demand worker job, which analyses it ahead of the queue on
   the interactive lane with headroom. A busy lane leaves it queued with
   interactive priority, so the next drain takes it first.
4. `readReviewAnalysisProgress` reports queued, running, analysed and
   not-analysable counts and the enrollment's verified-through time.

## Consequences

- An import's history is analysed at up to three reviews a minute per property.
  The newest reviews, the ones a manager is likeliest to answer, come first,
  and the one on screen is analysed within seconds.
- Admission refusals are cheap and harmless, so callers may ask again at the
  retry time without amplifying load.
- The backlog table is identifier-only operational state. It cascades with its
  property or review, is deleted by organization purge, and is classified as
  active authority in the data fate catalogue.
- A Redis outage stops all AI admission. That is unchanged: admission fails
  closed.
