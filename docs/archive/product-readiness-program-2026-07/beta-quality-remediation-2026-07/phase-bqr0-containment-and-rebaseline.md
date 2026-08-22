# BQR-0 — Containment and Rebaseline

**Status:** Implementation complete (pending PR merge)  
**Depends on:** None  
**Unblocks:** BQR-1  
**Estimate:** 3–5 engineering days

## Outcome

Unsafe paths are contained so intermediate work cannot process real Google content through broken durable infrastructure or execute dark capabilities. A truthful baseline inventory records what is proven vs scaffolded.

## Scope completed

### Containment

| Control                     | Mechanism                                                                                          | Default                            |
| --------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Outbox relay + dispatcher   | `OUTBOX_DISPATCHER_ENABLED` env flag in worker                                                     | `false` (safe)                     |
| Dark server functions       | `assertBetaCapability` / `assertGlobalCapability` on team, portal, guest, goal, badge, leaderboard | Denied (non-core / blocked)        |
| Dark / blocked jobs         | `isCapabilityJobEnabled` schedule gate + `registerCapabilityGatedJob` no-op handlers               | Not scheduled; leftover jobs no-op |
| Portal/guest effective dark | `portal.read` removed from core capabilities                                                       | Off unless allowlisted             |
| Outbound email jobs         | Gated on `notification.send_email` (blocked)                                                       | Digest/urgent no-op                |

Jobs gated dark/blocked:

- Goal: reconcile progress, spawn recurring instances
- Badge: `badge.reconcile`
- Leaderboard: `leaderboard.reconcile`
- Portal: process-image (`portal.upload`)
- Notification: digest + urgent email

Jobs intentionally left running (enabled / internal):

- Health check
- Review refresh-expiring / purge-expired
- Metric rollup refresh
- In-app insert-notification / activity insert
- Integration import / review sync / publish-reply (user-facing enabled surface)

### Inventory

- `bqr0-truthful-baseline.md` — P0/P1 findings with open vs remediated status
- Capability matrix updated post-containment

### Regression locks

- `src/shared/auth/dark-capability-enforcement.test.ts` — dark server fns + worker/bootstrap containment
- Unit coverage for `isCapabilityJobEnabled` / `portal.read` non-core

## Exit matrix

| Criterion                                                 | Evidence                                             | Owner   | Met?           |
| --------------------------------------------------------- | ---------------------------------------------------- | ------- | -------------- |
| Outbox dispatcher cannot start without explicit env       | `src/worker/index.ts`, env schema, architecture test | Eng     | Yes            |
| Dark context server fns assert capability                 | Grep + `dark-capability-enforcement.test.ts`         | Eng     | Yes            |
| Dark/blocked jobs not scheduled by default                | Worker schedule loop + capability helper             | Eng     | Yes            |
| Dark/blocked job handlers no-op when capability off       | `bootstrap.ts` `registerCapabilityGatedJob`          | Eng     | Yes            |
| `portal.read` not core                                    | `beta-capabilities.ts` + unit test                   | Eng     | Yes            |
| Truthful baseline document exists                         | `bqr0-truthful-baseline.md`                          | Eng     | Yes            |
| Typecheck / lint / format / web+worker build / unit tests | Local gates on branch                                | Eng     | See PR         |
| No real-property pilot until later gates                  | Master plan §3.5 policy                              | Product | Policy only    |
| Atomic outbox / schema / PII / authorize                  | Deferred                                             | BQR-1…4 | N/A (not exit) |

## Residual exceptions (time-bounded)

| Exception                                | Risk                                            | Disposition                                    | Expiry      |
| ---------------------------------------- | ----------------------------------------------- | ---------------------------------------------- | ----------- |
| Use cases lack capability asserts        | Bypass if any non-server entry enqueues work    | Accept for BQR-0; close in BQR-4               | BQR-4       |
| UI routes for dark contexts still mount  | UX confusion, not data mutation if server gated | Accept; harden in BQR-5                        | BQR-5       |
| Redis may retain old repeatable job keys | Handlers no-op; noise in logs                   | Operator purge on deploy; document             | Next deploy |
| ADR 0032 still lists portal.read as core | Doc/code drift                                  | Superseded by BQR posture; revise ADR in BQR-4 | BQR-4       |
| Enabled-path partial wiring              | Product risk if pilot starts early              | Stop-the-line: no pilot until BQR-6/7          | BQR-7       |

## Explicit non-goals (do not reopen in BQR-0)

- Fix outbox atomicity / envelope / consumers (BQR-2)
- Align Drizzle with migrations 0006–0008 (BQR-1)
- Wire source-content lifecycle (BQR-3)
- Make `authorize()` the sole production auth seam (BQR-4)
- Playwright/Storybook blocking gates (BQR-5)
- Staging scale/recovery (BQR-6)
- Real property pilot (BQR-7)

## How to verify locally

```bash
# Capability + architecture tests
pnpm exec vitest run src/shared/auth/dark-capability-enforcement.test.ts src/shared/auth/beta-capabilities.test.ts

# Broader unit suite (as CI)
pnpm test:unit   # or project-equivalent
```

Confirm worker logs on start (without env overrides):

- `Outbox relay + dispatcher DISABLED (BQR-0 containment)`
- `BQR-0: dark/blocked capability job NOT scheduled` for goal/badge/leaderboard/digest
- `registered no-op job handler (capability dark/blocked)` for those jobs

## Next phase

**BQR-1 — Architecture and schema coherence**

1. Executable dependency-boundary rules and domain-error convention resolution.
2. Represent migrations 0006–0008 in canonical Drizzle schemas (or contract unused columns with evidence).
3. Remove dual truths for review lifecycle / sync / rollup models.
4. Do not re-enable `OUTBOX_DISPATCHER_ENABLED` until BQR-2 exit.
