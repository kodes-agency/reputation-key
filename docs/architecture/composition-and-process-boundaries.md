# Composition and process boundaries

**Status:** Current architecture note (ARC-03).
**Scope:** How an Application Container is built, what each deployable is
allowed to hold, and where the executable authorities for those rules live.

---

## 1. One deployment

Beta runs exactly **one deployment** serving every supported country. There is
no second cell, no cross-cell effect, and no cell selection at runtime: a
property carries its `country_code` and `timezone` and nothing else about
where it is processed.

Every process described below belongs to that one deployment.

## 2. Three deployables

| Deployable  | Serves             | Holds                                                         | Must NOT hold                                     |
| ----------- | ------------------ | ------------------------------------------------------------- | ------------------------------------------------- |
| **web**     | HTTP requests      | Request capabilities, the operational read, the policy trio   | Worker registration, operator repair capabilities |
| **worker**  | Jobs and events    | Worker registration, job dispatch handles, the policy trio    | Operator repair capabilities                      |
| **sidecar** | One trust boundary | Its own composition unit (e.g. the Google provider authority) | Any database handle, any job queue handle         |

The **operator** surface is a fourth, short-lived process shape: a reviewed
repair command holds `*MaintenanceRuntime` capabilities and never registers a
consumer or a schedule.

Executable authority: [`src/composition/deployables.ts`](../../src/composition/deployables.ts)
and its test. It projects the container's key set per deployable and proves the
three projections partition the whole surface.

## 3. One container per process

A process builds exactly **one complete Application Container**. A second build
fails with

```
[COMPOSITION] a complete Application Container already exists in this process
```

This matters because a container owns process-visible resources: the capability
policy trio, the durable outbox consumer registry, and queue connections. A second container would silently install a second set,
and the process would answer policy questions from whichever one happened to be
bound.

`shutdown.run()` releases the container's background work AND the process claim,
so a supervised restart may rebuild exactly once.

Executable authority:
[`src/shared/testing/process-fixtures/`](../../src/shared/testing/process-fixtures/) —
each deployable is spawned as an independent child process with a fixed injected
environment and emits one content-free boot report
(`{deployable, containerBoots, jobNames, consumerNames, schedulerIds, policyBindings, openHandleNames}`).
Names and counts only: no tenant, review, guest or credential value ever appears
in a boot report. A fixture that cannot boot exits non-zero and emits nothing —
evidence is never fabricated.

## 4. What the composition root does

The root SELECTS implementations and configuration, and returns only what entry
points need. It:

- resolves configuration once and injects it (no context or entry point re-reads
  ambient configuration — see
  [`src/shared/architecture/ambient-runtime-read-authority.ts`](../../src/shared/architecture/ambient-runtime-read-authority.ts));
- consumes **named capability groups** from each context, never a context's
  private wiring (`docs/standards.md` §3.1);
- names every cross-context seam as an application-owned port with a contract
  test (`src/shared/architecture/named-cross-context-seams.test.ts`);
- selects the framework and provider adapters — the request context and the
  authenticated session are injected ports, not direct calls.

Cohesive sub-graphs live in their own modules under `src/composition/`:
provider runtime, infrastructure, the Google provider trust boundary, the
member-authority seam, the operational readout, and the deployable projections.

## 5. Boundary controls

`node scripts/check-architecture-boundary-controls.mjs` runs the in-memory
boundary controls that keep these rules enforceable rather than aspirational.

## 6. Capability posture

Portal upload, Contact Request, Recognition (badge/leaderboard), Team, Bulk
Close, Staff User login, Billing and MFA remain **dark**. No composition or
deployable change may make one reachable; the capability posture lives in
`src/shared/auth/beta-capabilities.ts` and is deliberately frozen.
