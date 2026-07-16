# BQR-6 — Operations, Topology, Recovery, and Target-Scale Proof

**Status:** In progress — slice 6.1  
**Depends on:** BQR-2 (durable runtime), BQR-5 (blocking experience gates)  
**Unblocks:** BQR-7 real-property pilot  
**Estimate:** 10–17 engineering days

## Outcome

A production-like topology is defined and exercised. Liveness/readiness probes, worker health, queue lag, and recovery targets (RPO ≤ 15 min, RTO ≤ 4 hr) have **executable evidence**. Local scale proof from PRE17C is retained; staging fault/load execution is planned and blocked only on environment access (not code).

Master plan §7.3 evidence pack: `docs/release-evidence/beta/<release-id>/scale-and-recovery.md`.

## PR slices (planned)

| Slice       | Outcome                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------- |
| **BQR-6.1** | Live/ready health probes + phase plan + release-evidence scaffold                                   |
| **BQR-6.2** | Worker heartbeat / queue-depth surface (operator-visible metrics or health extension)               |
| **BQR-6.3** | Document + script re-run of local scale harness (`scripts/perf/*`) into evidence pack               |
| **BQR-6.4** | Staging load/fault checklist + runbook links (execution may require human/env)                      |
| **BQR-6.5** | Recovery rehearsal notes (backup/restore, outbox drain) — RPO/RTO claims with evidence or exception |

## Exit criteria

| Criterion                                          | Target                                    |
| -------------------------------------------------- | ----------------------------------------- |
| Liveness ≠ readiness (deps not in live probe)      | `/api/health/live` vs `/api/health/ready` |
| Health probes covered by unit tests                | Yes                                       |
| Local scale evidence linked from BQR-6 plan        | PRE17C scale evidence retained            |
| Staging load/fault matrix either green or ticketed | Explicit                                  |
| RPO/RTO either proven or expiring exception        | Explicit                                  |
| No required evidence job uses `continue-on-error`  | Already (BQR-5.3 storybook hard)          |

## Inherited assets

| Asset                    | Path                                                      |
| ------------------------ | --------------------------------------------------------- |
| Local scale proof        | `docs/performance/pre17c-scale-evidence.md`               |
| Load/fault harness       | `scripts/perf/load-test.ts`, `scripts/perf/seed-scale.ts` |
| Ops runbooks             | `docs/operations/runbooks.md`                             |
| Service objectives ADR   | `docs/adr/0038-beta-service-objectives-and-recovery.md`   |
| Combined health (legacy) | `/api/health` → same body as ready                        |

## Human / env blockers

- Staging Redis/Postgres credentials and load environment for full PRE17C §9.2–9.3 execution.
- Backup/restore tooling access for RTO proof.
- BQR-7 pilot remains human-gated (real properties).

## Notes

- `OUTBOX_DISPATCHER_ENABLED` stays **default-off** until explicit exit (master plan + BQR-0).
- Synthetic/disposable data only until BQR-6 complete (master plan § data policy).
