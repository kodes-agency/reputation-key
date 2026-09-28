---
status: accepted
date: 2026-08-26
---

# 0053 — Production Redis workload posture

## Context

BullMQ, cache, and rate-limit state have different failure semantics. BullMQ
requires `maxmemory-policy=noeviction`; cache and rate-limit keys must be
bounded by TTL; HTTP producers cannot wait indefinitely for Redis. A shared
instance forces one eviction policy on all three: `noeviction` turns cache
and rate-limit pressure into write failures, while any eviction policy can
silently drop queue metadata.

## Decision

1. Production requires physically distinct Redis endpoints for cache and
   rate-limit state (`REDIS_URL`) and for BullMQ (`QUEUE_REDIS_URL`). Web and
   worker refuse to boot when either URL is absent or invalid, or when both
   resolve to the same host and port
   (`assertProductionRedisTopology()` in `src/shared/jobs/redis-topology.ts`,
   reason codes `cache_url_missing`, `queue_url_missing`, `cache_url_invalid`,
   `queue_url_invalid`, `endpoints_not_isolated`). Development and test may
   use one Redis.
2. Before constructing BullMQ, production verifies that the queue Redis is
   Redis 6.2 or newer, supports `GETDEL`, and runs
   `maxmemory-policy=noeviction`. Missing or ambiguous runtime facts fail
   closed with a content- and credential-free reason.
3. Every cache and rate-limit key has a bounded TTL. Producers use a bounded
   connect/command budget and one retry; worker blocking connections use
   BullMQ's required `maxRetriesPerRequest=null` and bounded process shutdown.
4. PostgreSQL and its transactional outbox are the recovery authority. Redis
   contains disposable delivery and acceleration state; no AOF or Redis backup
   is required for accepted application facts.
5. Better Auth's shared limiter uses atomic Redis storage and keeps sessions
   and verification records in PostgreSQL. Redis failure propagates and fails a
   production auth request closed.
6. Production runs two managed Redis resources today (cache/rate-limit and
   queue). Consolidating them would be a new decision that changes
   `redis-topology.ts`, the runtime-environment contract, and the runbooks
   together; it is not an operational shortcut.

## Consequences

- A Redis outage delays queued effects while accepted outbox facts remain
  recoverable.
- `noeviction` and queue age are monitored on the queue Redis; TTLs and
  producer deadlines are monitored on the cache Redis.
- A cache Redis outage or memory pressure cannot evict queue metadata, and a
  queue backlog cannot turn cache and rate-limit writes into OOM failures.
- Recovery provisions clean Redis state, restores PostgreSQL when necessary,
  and lets the outbox relay rebuild work.
- Recurring job schedulers are Redis state as well. A running worker checks
  every minute that each governed scheduler still exists and re-installs only
  the missing ones (re-upserting a present cron scheduler would drop its
  overdue run), so a Redis restart does not silently stop digests, repair
  sweeps, or the health-check that evaluates every alert. Boot reconciliation
  records its plan's fingerprint beside the schedulers, and the watchdog
  restores only for the plan recorded there (claiming the record back when it
  was lost with them), so during a deploy overlap an outgoing worker cannot
  re-install a scheduler its successor's boot removed.

## Rejected alternatives

- **One shared Redis for cache, rate limits, and queues** — a single eviction
  policy cannot serve both workloads: `noeviction` fails cache and limiter
  writes under pressure (and the auth limiter fails closed), while an
  eviction-capable policy can drop queue metadata.
- **Eviction-capable BullMQ storage** — can silently lose queue metadata.
- **Process-memory rate limiting in production** — replica-local allowance is
  neither shared nor fail-closed.

## Amendments

- **2026-09-28** — Restored the enforced posture. On 2026-09-07 (WP4.3a) this
  ADR's text was rewritten, as a documentation-only change, to allow one
  shared Redis with "no same-host boot refusal". Neither the code
  (`endpoints_not_isolated` stayed enforced), the other runbooks, nor the live
  `closed-beta-v2` environment (two Redis resources) changed with it. This
  amendment makes the record match what production enforces.
