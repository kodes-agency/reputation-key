# Scale and recovery evidence

**Release id:** _TBD_  
**Owner:** _TBD_  
**Date:** _TBD_

## Local scale (required)

- [ ] Link or paste results from `docs/performance/pre17c-scale-evidence.md`
- [ ] Commands run: `pnpm exec tsx scripts/perf/seed-scale.ts` / `load-test.ts --scenario=…`
- [ ] Dataset: orgs / properties / reviews

## Health probes (BQR-6.1 / 6.2)

| Probe     | URL                       | Expected                                     |
| --------- | ------------------------- | -------------------------------------------- |
| Liveness  | `GET /api/health/live`    | 200 `{ status: "ok" }`                       |
| Readiness | `GET /api/health/ready`   | 200 when DB+Redis up; 503 degraded otherwise |
| Combined  | `GET /api/health`         | Same as readiness (compat)                   |
| Metrics   | `GET /api/health/metrics` | Outbox lag, queue depths, worker heartbeat   |

## Staging load / fault (BQR-6.4)

- [ ] Steady 20/s × 30 min
- [ ] Burst 100/s × 60s + drain ≤ 10 min
- [ ] Redis unavailable / restart
- [ ] Worker SIGTERM drain
- [ ] DB failure pre/post commit

## RPO / RTO (BQR-6.5)

| Metric | Target    | Result    | Evidence |
| ------ | --------- | --------- | -------- |
| RPO    | ≤ 15 min  | _pending_ |          |
| RTO    | ≤ 4 hours | _pending_ |          |

## Exceptions

List any expiring exceptions with owner and ticket.
