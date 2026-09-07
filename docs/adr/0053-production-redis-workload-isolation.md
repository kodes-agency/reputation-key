---
status: accepted
date: 2026-08-26
---

# 0053 — Production Redis workload posture

## Context

BullMQ, cache, and rate-limit state may share one managed Redis during the
single-tenant closed beta, but they have different failure semantics. BullMQ
requires `maxmemory-policy=noeviction`; cache and rate-limit keys must be
bounded by TTL; HTTP producers cannot wait indefinitely for Redis.

## Decision

1. One production Redis may serve BullMQ, cache, and rate-limit state.
   `REDIS_URL` and `QUEUE_REDIS_URL` may name the same managed resource; there
   is no same-host boot refusal.
2. Before constructing BullMQ, production verifies Redis 6.2 or newer,
   `GETDEL`, and `maxmemory-policy=noeviction`. Missing or ambiguous runtime
   facts fail closed with a content- and credential-free reason.
3. Every cache and rate-limit key has a bounded TTL. Producers use a bounded
   connect/command budget and one retry; worker blocking connections use
   BullMQ's required `maxRetriesPerRequest=null` and bounded process shutdown.
4. PostgreSQL and its transactional outbox are the recovery authority. Redis
   contains disposable delivery and acceleration state; no AOF or Redis backup
   is required for accepted application facts.
5. Better Auth's shared limiter uses atomic Redis storage and keeps sessions
   and verification records in PostgreSQL. Redis failure propagates and fails a
   production auth request closed.
6. Add a second managed Redis only after measured traffic or an actual cache
   outage shows that shared-resource blast radius is worth the operational
   cost.

## Consequences

- A Redis outage delays queued effects while accepted outbox facts remain
  recoverable.
- `noeviction`, TTLs, producer deadlines, and queue age are monitored on the
  shared resource.
- Recovery provisions clean Redis state, restores PostgreSQL when necessary,
  and lets the outbox relay rebuild work.

## Rejected alternatives

- **Mandatory cache/queue separation from day one** — duplicates a managed
  service and its incident surface before one beta tenant has measured the need.
- **Eviction-capable BullMQ storage** — can silently lose queue metadata.
- **Process-memory rate limiting in production** — replica-local allowance is
  neither shared nor fail-closed.
