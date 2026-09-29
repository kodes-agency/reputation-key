---
status: accepted
date: 2026-09-29
---

# 0060 — Property source fence and the worker pool budget

## Context

On closed-beta-v2 (2026-09-29) a Google import inserted 244 reviews into one
Property in 30 seconds. Many consumers then failed at the 10 s lock timeout
(`select "source_epoch" from "properties" ... for update`,
`metric.commandStore.recordMetrics failed after ~10000ms`, 21 failed
`review.created` jobs), and `sync-property-reviews` was quarantined. PR #634
traced three causes.

1. **The fence blocked foreign-key checks.** Every review import, Inbox
   projection and AI sequence allocation locks the Property row to fence
   `source_epoch`, through `lockReviewSourceMutationScope` or
   `lock_review_ai_analysis_head_v1`. They only read the row, but they took it
   `FOR UPDATE`. That mode also conflicts with the `FOR KEY SHARE` lock a
   foreign-key check takes, so inserts into `metric_readings`,
   `ai_property_aggregate_settlements` and `notifications` for the Property
   queued behind the import.
2. **The pool starved.** The Inbox projection held the fence while its consumer
   asked the pool for a second client. The worker's pool had 10 clients, but
   only the default queue was budgeted against it. The background drain
   (8 analyses since #613) and domain-event dispatch (10 consumers since #615)
   used the same 10. Once the pool was empty, the fence holder waited up to
   15 s for its client while every other client sat in a transaction queued on
   the fence, and those failed at 10 s.
3. **The enrollment replay inverted the lock order.** It locked its enrollment
   row and candidate reviews, then reached the Property through the sequence
   function. Review writers take Property before Review, and an authorization
   change takes Property before its enrollments, so an import during AI
   enablement could deadlock.

## Decision

1. **The source fence is `FOR NO KEY UPDATE`.** `lockReviewSourceMutationScope`,
   `lock_review_ai_analysis_head_v1` (migration 0040), the bulk lifecycle fence
   and the AI fence helper (`lockReviewAnalysisPropertyFence`) all take this
   mode. It still conflicts with itself, with `FOR UPDATE` and with
   `UPDATE properties`, so fence holders and epoch writers exclude each other as
   before. Only foreign-key checks stop waiting. `FOR SHARE` is not used: a
   caller that later needed exclusivity would upgrade across the Reply-truth
   lock and could deadlock. No path takes the fence and then escalates on the
   Property row.
2. **A lock holder never waits for a pool client.** A unit of work that holds a
   lock while it opens a second transaction checks out every client it needs
   before it takes the lock (`withReservedPoolClients`). The Review
   exact-current authorities do this inside their admission. Clients the unit
   releases return to its reservation until it settles, so a plain read before
   the consumer's transaction cannot give that transaction's client away.
   Reservations are taken one at a time per pool. A reserved client whose
   connection drops while it waits is evicted, never lent, and the session
   guards every new connection runs are bounded by the connection timeout, so a
   connection that never answers cannot hold the reservation queue.
3. **The worker's pool is sized from every queue.** `src/worker/pool-budget.ts`
   adds each queue's concurrency times its peak clients per job, the AI drain,
   the second client of each admitted exact-current apply, and the relay and
   recovery timers. With the concurrency #613 and #615 set, that is 49. The
   worker sets it at boot (`configurePoolMaxConnections`). Web keeps 10: its
   request concurrency is unbounded, so it relies on rule 2. The budget test
   checks that both services' pools, doubled for Railway's deploy overlap, plus
   20 for operators, fit under the database's `max_connections` (500 on
   closed-beta-v2, read 2026-09-29).
4. **The Property is locked first.** The enrollment replay locks the Property
   before its enrollment row and reviews, and the reopen pass before its
   reviews. An authorization change locks the Property in its own first
   statement, before the enablement and enrollments: one statement locking
   both took the enablement first and could deadlock against a merchant AI
   transition, which takes the Property first. It keeps `FOR UPDATE`.

## Consequences

- A 40-review burst on one Property over a pool of 10 (the regression test in
  `src/shared/architecture/property-lock-burst.integration.test.ts`) went from
  37 lock-timeout failures and 16 s to none and under half a second.
- The worker can open up to 49 connections. Changing a queue's concurrency moves
  the pool with it; the budget test fails if the total no longer fits the
  database.
- Parallel reads that fan out per recipient or per cycle are not budgeted.
  They hold no lock while they wait, so past the budget they only queue.
- The Google import item job still holds its item row while it waits for a
  second client. That row is not the Property fence, and the budget covers it.
- The fence is still held while an exact-current consumer commits on its own
  connection. That consumer must not lock the same Property row (`FOR SHARE`
  or stronger, or `UPDATE`): it would wait on its own caller until
  `lock_timeout`. None does; only its foreign-key checks touch the row, and
  they no longer wait.
