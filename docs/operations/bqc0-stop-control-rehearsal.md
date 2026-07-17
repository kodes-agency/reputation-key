# BQC-0.4 — Stop-Control Rehearsal

**Date:** 2026-07-17
**Executor:** engineering (agent-assisted)
**Scope:** the six containment controls required by BQC-0.4. Each control is **temporary boot-time containment**; the removal slice is BQC-2 (persisted, authoritative capability policy), which replaces env-level controls with operator-managed persisted policy.
**Rule:** containment must be reversible and must never delete jobs, outbox rows, or canonical state.

## Control matrix

| #   | Control                                        | Mechanism                                                                                                                                       | Class                                   |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | Disable Google sync / import / publish         | `BETA_CAPABILITIES_OFF=property.connect_gbp,property.publish_reply` + restart                                                                   | boot-time env, per-capability kill list |
| 2   | Disable durable relay / dispatcher / schedules | `OUTBOX_DISPATCHER_ENABLED` (default off); dark schedules gated + no-op handlers; queue pause for the rest                                      | boot-time env + capability gates        |
| 3   | Deny new property activation                   | `BETA_CAPABILITIES_OFF=property.create`                                                                                                         | boot-time env, per-capability kill list |
| 4   | Quarantine a queue without deleting jobs       | `pnpm ops:queue pause <default\|background\|domain-events>` (`resume` to restore)                                                               | operator CLI (BullMQ pause/resume)      |
| 5   | Deny all Phase 17/18 (AI) work                 | `ai.*` non-core (default deny) + blocked AI-adjacent caps + boot assertion (BQC-0.3); no AI implementation exists to gate                       | capability policy (default deny)        |
| 6   | Preserve evidence and canonical state          | outbox append-only (purge fns have no callers); quarantine = pause, never obliterate; destructive cleanup scripts prohibited during containment | design + procedure                      |

## Rehearsal results (executed 2026-07-17, local)

### 1. Google sync / import / publish stop

- **Procedure:** set `BETA_CAPABILITIES_OFF=property.connect_gbp,property.publish_reply`, restart web + worker.
- **Proof (unit):** `beta-capabilities.test.ts` — kill-list store tests (listed caps off, unlisted untouched, unknown entries inert, blocked stay blocked). Job-gate tests: `sync-property-reviews.job.test.ts`, `import-property.job.test.ts`, `publish-reply.job.test.ts` — handlers skip without calling the use case / Google API when the capability is off, and run normally when on. 40/40 green.
- **Proof (boot):** worker started with the kill list; startup manifest recorded the posture:

  ```
  "capabilityPolicy":{"policyVersion":"bqc-0.3","nodeEnv":"production",
    "killSwitchActive":false,
    "disabledCapabilities":["property.connect_gbp","property.publish_reply"], ...}
  ```

- **Runbook:** `docs/operations/runbooks.md` §11 corrected — previously prescribed a comma list that the old `=== '1'` implementation would have **silently ignored**; the list form now works as documented, and `all` is the documented full stop.

### 2. Durable relay / dispatcher / schedules stop

- **Procedure:** keep `OUTBOX_DISPATCHER_ENABLED` unset/false (default). Worker log confirms: "Outbox relay + dispatcher DISABLED (BQR-0 containment)". Consumers stay registered but inert; events still deliver via the in-process bus.
- **Schedules:** dark-context schedules (goal/badge/leaderboard/digest) are gated by `isCapabilityJobEnabled` and get no-op handlers (`bootstrap.ts`); the remaining schedules (health-check, metric rollups, review retention) have no external side effects. To stop processing entirely without deleting jobs, pause the `background` queue (control 4).
- **Proof:** worker boot log lines (captured during the control-1 smoke); dark-job gating covered by `dark-capability-enforcement.test.ts` (27 tests).

### 3. Deny new property activation

- **Procedure:** set `BETA_CAPABILITIES_OFF=property.create`, restart. All property mutations/reads map to the `property.create` capability, so creation is denied at the authorization seam (`requireAuthorized` → capability layer → deny).
- **Proof (unit):** kill-list store test — `property.create` off while unrelated caps stay on.
- **Honest limit:** the per-property lifecycle suspension machine (`property-lifecycle.ts`) is dead code today — there is no per-property stop, only the global/per-capability one. Per-property controls are BQC-2 scope (persisted policy), as is the `isPropertyAllowlisted` store stub.

### 4. Queue quarantine without deleting jobs

- **Procedure:** `pnpm ops:queue pause default` → workers stop picking up work; every waiting/active/failed job stays in Redis. `pnpm ops:queue resume default` restores. `status` is read-only. Unknown queue names fail closed (`unknown queue "defualt" — expected one of: default, background, domain-events`).
- **Proof (unit):** `queue-quarantine.test.ts` — pause/resume/status; job counts identical before/after pause (no deletion). 4/4 green.
- **Proof (CLI smoke):** no-args → usage + exit 1; unknown queue → named error + exit 1; missing `REDIS_URL` → clean refusal + exit 1.
- **Not executed locally:** a live Redis pause/resume cycle (no local Redis). Staging steps below.

### 5. Phase 17/18 (AI) deny

- **Posture:** `ai.analyze`, `ai.generate_reply`, `ai.detect_trends` are non-core (default deny, allowlistable per ADR 0031); `gbp.reply.auto_publish`, `gbp.ai.cross_property_summary`, `gbp.review_solicitation_gamification` are hard-blocked and covered by the BQC-0.3 boot assertion. No AI implementation code exists, so the deny is policy-level.
- **Procedure:** keep `BETA_ALLOWLIST_ORGS` unset in production; the worker boot manifest records effective posture (no `ai.*` in core/blocked-override output).
- **Proof (unit):** boot-guard suite (18 tests) — blocked-capability boot assertion fails startup if any blocked cap is globally enabled.
- **Decision deferred:** whether to promote `ai.*` from non-core to hard-blocked until BQC-9 contradicts ADR 0031's conditional allowance and is explicitly left to BQC-2/BQC-9.

### 6. Evidence and canonical-state preservation

- **Outbox:** append-only — `markPublished` only stamps `publishedAt`; `purgePublishedBefore`/`purgeReceiptsBefore` have no callers. Containment does not lose event history.
- **Queues:** quarantine is pause/resume only (control 4); `obliterate`/`clean` are never used for containment.
- **Procedure:** during containment, do NOT run `scripts/cleanup-all.ts` / `cleanup-kodes.ts` (destructive DB deletes).
- **Known limitation:** BullMQ `defaultJobOptions` prune completed/failed jobs (`removeOnComplete: 100`, `removeOnFail: 50`) — queue jobs are operational residue, not evidence; canonical evidence is DB + outbox. A DLQ/evidence-grade job retention design is BQC-3/BQC-7 scope.

## Staging rehearsal (open steps — before BQC-0 acceptance)

Executed against staging web+worker with real Redis:

1. Set the kill list, restart, trigger sync + publish → expect skip logs and zero Google calls; remove list, restart, confirm backlog drains.
2. `pnpm ops:queue pause default` under load → confirm zero in-flight losses and identical job counts; `resume` → backlog drains.
3. Toggle `OUTBOX_DISPATCHER_ENABLED=true` in the staging worker, observe relay/dispatch, then back to false → confirm no duplicate side effects.

**Owner:** engineering. **When:** BQC-0.5 baseline window. Results to be appended here with the release identity they ran against.
