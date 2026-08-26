---
status: accepted
date: 2026-08-26
---

# 0053 — Production Redis workload isolation

## Context

RepKey used one Redis endpoint for cache/rate-limit state and BullMQ. Those
workloads have incompatible operational contracts. BullMQ requires
`maxmemory-policy=noeviction`, durable delivery is recovered from PostgreSQL's
outbox, and worker blocking connections must tolerate transient disconnects.
HTTP producers must instead fail within a bounded request budget. Cache and
rate-limit state have independent capacity, failure, and recovery concerns.

A logical database number, a different credential, or separate client objects on
one Redis server do not isolate memory pressure, eviction policy, maintenance, or
failure. They also make a regional queue outage indistinguishable from a cache
outage. Every Railway Data Cell therefore needs a topology that can be declared
and upgraded consistently without hand-wiring services.

## Decision

1. Every production Data Cell has two physically distinct managed resources:
   `Cache Redis` and `Queue Redis`. `REDIS_URL` names cache/rate-limit state;
   `QUEUE_REDIS_URL` names BullMQ state. Web and worker receive references to
   both resources in their own cell and never fall back to another cell.
2. Production web and worker refuse boot when either URL is absent, malformed,
   or resolves to the same host and port. Database numbers and credentials do
   not count as physical isolation. Development and tests may omit
   `QUEUE_REDIS_URL` and use `REDIS_URL` for both to keep lightweight workflows
   available.
3. Before constructing any BullMQ client, both production processes inspect the
   queue runtime. Redis 6.2 or newer, `GETDEL`, and
   `maxmemory-policy=noeviction` are mandatory. Ambiguous or denied inspection
   fails closed with a content- and credential-free reason code.
4. Queue producers use a bounded connect/command budget and one retry. Worker
   blocking connections use BullMQ's required `maxRetriesPerRequest=null` and
   are bounded by the process's explicit shutdown policy.
5. Readiness requires both Redis resources. The public response retains the
   existing aggregate `redis` field for compatibility; internal probes test the
   resources independently. Liveness remains dependency-free.
6. Neither Redis resource is the recovery authority. PostgreSQL and its outbox
   hold durable application facts. Recovery provisions fresh cache and queue
   resources, restores PostgreSQL under the Data Cell procedure, then lets the
   relay rebuild queue work. Local AOF is restart-test evidence, not backup
   authority.
7. The typed Railway graph owns both resources, regional placement, and service
   references. Applying that graph remains a separately reviewed operator
   action; repository validation never mutates Railway.

## Consequences

- A cache outage and a queue outage are separately observable and can be
  rehearsed independently.
- Each production cell incurs one additional managed Redis resource in exchange
  for genuine failure and policy isolation.
- Web readiness degrades when either resource is unavailable, while the durable
  outbox prevents accepted database facts from being lost during a queue outage.
- Provider-ephemeral Redis remains a third, stricter trust boundary and must be
  distinct from both general application resources.
- ADR 0050's phrase “general BullMQ/quota Redis” is historical shorthand. Quota
  and BullMQ state are no longer permitted to share one production endpoint.

## Rejected alternatives

- **Separate Redis database numbers** — they share process failure, memory, and
  eviction configuration.
- **One resource with separate ACL users** — credentials isolate commands, not
  resource pressure or maintenance.
- **Queue fallback to Cache Redis in production** — it silently defeats the
  decision during the exact failure where isolation is needed.
- **Make every environment run two daemons** — hermetic unit tests and basic
  local development do not need production topology; production-shaped local
  and staging-cell workflows do.

## Required evidence

- All three offline Railway cell graphs contain `Cache Redis` and `Queue Redis`
  in the cell region and wire exact, distinct references into web and worker.
- Production topology and runtime guards reject absent, shared, unsupported, or
  eviction-enabled queue configurations before client construction.
- Real-Redis integration proves runtime inspection and bounded queue health.
- The production-shaped local stack proves independent cache and queue faults,
  clean stores, recovery, and no duplicate external effects.
