# Composition and process boundaries

**Status:** Current architecture note (ARC-03).
**Scope:** How a complete Application Container is built, how each process
enters it, and where the executable authorities for those rules live.

---

## 1. One deployment

Beta runs exactly **one deployment** serving every supported country. There is
no second cell, no cross-cell effect, and no cell selection at runtime: a
property carries its `country_code` and `timezone` and nothing else about
where it is processed.

Every process described below belongs to that one deployment.

## 2. Process entry points

| Process        | Construction                                                                 | Runtime distinction                                           |
| -------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **web**        | `getContainer()` claims `web`, then calls `createContainer()`                | Serves HTTP and never imports worker bootstrap                |
| **worker**     | Claims `worker`, then calls `createContainer({ enableJobs: true })`          | Sole production importer of `bootstrap()`                     |
| **operator**   | The ops harness claims `operator`, then calls `createOperatorContainer()`    | No jobs or ambient Redis; three provider command paths refuse |
| **simulation** | `createSimulationContainer()` claims `simulation`, then injects its backends | In-memory queue and an explicit process-policy binding        |
| **sidecar**    | Own composition unit (for example, the Google provider authority)            | No database or job-queue handle                               |

All application processes receive the complete container rather than a
post-construction key projection. Their runtime behavior is selected by options,
registration calls, and the refusing operator graph. Executable authority lives
in `src/composition.ts`, `src/worker/index.ts`,
`src/composition/operator-container.ts`, and
`src/shared/testing/simulation-container.server.ts`.

## 3. One container per process

Each process entry point claims exactly **one complete Application Container**
before it builds. A second claim fails with

```
[COMPOSITION] a complete Application Container already exists in this process
```

The claim uses `Symbol.for` because production bundles the composition root
twice; both copies must observe the same process owner. `createContainer()` stays
an injectable wiring function, while `getContainer()`, the worker, the operator
harness, and the simulation factory own process admission.

This matters because a container owns process-visible resources: the capability
policy trio, the durable outbox consumer registry, and queue connections. A
second entry-point container could silently install another set, and the process
would answer policy questions from whichever one happened to be bound.

The web owner releases through `closeContainer()`, the operator harness releases
in its cleanup, the simulation releases when its container shuts down, and the
worker owns its claim for the process lifetime.

Executable evidence is split by behavior:

- `src/shared/architecture/one-container-per-process.test.ts` proves named
  refusal, release/rebuild, and that production bootstrap is worker-only;
- `src/shared/architecture/outbox-consumer-registration.test.ts` proves
  deterministic consumer registration across claimed worker rebuilds;
- `src/shared/auth/process-policy-binding.test.ts` proves the claimed simulation
  owns the process-policy binding and cannot cold-boot a web container.

## 4. What the composition root does

The root SELECTS implementations and configuration and returns one complete
container. Entry points choose its options and the registrations they run. The
root:

- resolves configuration once and injects it (no context or entry point re-reads
  ambient configuration — see
  [`src/shared/architecture/ambient-runtime-read-authority.ts`](../../src/shared/architecture/ambient-runtime-read-authority.ts));
- consumes **named capability groups** from each context, never a context's
  private wiring (`docs/standards.md` §3.1);
- names every cross-context seam as an application-owned port with a contract
  test (`src/shared/architecture/named-cross-context-seams.test.ts`);
- selects the framework and provider adapters — the request context and the
  authenticated session are injected ports, not direct calls.

Cohesive sub-graphs live in modules under `src/composition/`: provider runtime,
infrastructure, the Google provider trust boundary, member authority,
operational readout, and the refusing operator container.

## 5. Boundary controls

`node scripts/check-architecture-boundary-controls.mjs` runs the in-memory
boundary controls that keep these rules enforceable rather than aspirational.

## 6. Capability posture

Portal upload, Contact Request, Recognition (badge/leaderboard), Team, Bulk
Close, Member login, Billing and MFA remain **dark**. No composition or
process change may make one reachable; the capability posture lives in
`src/shared/auth/beta-capabilities.ts` and is deliberately frozen.
