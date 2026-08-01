# bqc8-local-candidate — environment and fidelity notes

**Read this before the measured pack.** It records what the local
production-shaped cell is, what each scenario therefore proves, and
what is deliberately NOT proven here.

## The environment

- Local production-shaped cell (BQC-8.2 `perf:cell`): production web
  build (`.output/server/index.mjs`, NODE_ENV=production) + production
  worker build (`dist-worker/index.js`), dedicated PostgreSQL database
  `repkey_bqc8_cell` (migration trio at deploy state), isolated Redis
  logical db 9, GBP + mail sandbox stubs (all provider endpoints
  pinned), deterministic non-placeholder secrets. Ports 3100/4150/4151.
- Dataset: deterministic `perf-scale-v1`-family seed — 100 orgs /
  5,000 properties / 500,000 reviews, manifest hash in
  `scale-dataset.json` (verified: exact counts, per-property
  distribution, skew bounds, hash).
- Release identity: `f5d5f6ed9ca0` (origin/main after BQC-8.1) + the
  BQC-8.2 harness branch. Policy versions recorded per run record.

## Fidelity: what the arrival-side scenarios prove — and what they don't

The seeded dataset has **no Google connections** (synthetic orgs). The
arrival jobs (sync-property-reviews) therefore fail fast at the
`Google connection not found` domain lookup and exercise the retry
policy. This is deliberate and recorded, not hidden:

- **Measured honestly here:** the producer/enqueue path at SLO rates
  (20/s steady, 100/s burst, 100/s hot-property), BullMQ dispatch and
  the BQC-3 retry machinery under load, queue depth/age behavior,
  backlog shape, tenant-fairness of the dispatch path, and the
  monitoring capture itself.
- **NOT proven here:** the full provider-ingest path (GBP fetch →
  store → project) at scale. Fast-failing jobs drain faster than real
  ingest would, so drain/catch-up timings are LOWER bounds for the
  failure-processing path, not ingest-capacity numbers.
- **Full fidelity in this pack:** dashboard read path (dashboardMix /
  dashboardCold over the real 500k dataset) and reply publication
  (replyBurst through a run-scoped connection + the GBP stub — the
  real publish path end to end).

Closing the ingest-fidelity gap requires synthetic provider
connections + stub fixtures for the fleet — that belongs to the
staging-cell acceptance execution (environment scheduling is the
owner's call), not to this local harness proof.

## Collector coverage

- App snapshot (outbox, queues, workers, db pool, cache, replies):
  captured every run (`/api/health/metrics`, ops-token gated).
- Redis memory/stats: captured when `redis-cli` is present
  (external collector).
- DB CPU/locks: **not collected in this environment** — no app- or
  CLI-readable surface; platform observability (Railway metrics) is
  the acceptance surface. Stated in every run record's `collectors`
  section, never silent.
