// ARC-03-T15 — the SIMULATION deployable, booted in its own process.
//
// A simulation is a process like the web and worker processes, and it must
// answer the same question: did exactly ONE Application Container boot here?
//
// It did not. createSimulationContainer built its container but installed no
// process policy trio, so the first policy-gated read inside an event handler
// fell through to the WEB cold-boot fallback — which builds a second container
// from ambient environment. Where the ambient build succeeded the simulation
// silently decided against a different container's policy state; where it failed
// (CI, which sets only the variables the job declares) every event handler
// threw and the projections they own were never made. Neither outcome was
// visible from inside a shared vitest worker, because there the policy trio is
// already installed by whichever suite ran first.
//
// This fixture reads the composition singleton directly. That is deliberate:
// the presence of a singleton container is the FACT being reported, and asking
// getContainer() for it would build the very thing under test.

import { createSimulationContainer } from '#/shared/testing/simulation-container.server'
import { getExecutionPolicy } from '#/shared/auth/execution-policy'
import { boundProcessPolicies } from '#/shared/auth/process-policy-binding'
import { emitBootReport } from './boot-report'
import { FIXTURE_CLOCK_INSTANT } from './fixture-runtime'

/** The key src/composition.ts stores its lazy singleton under. */
const CONTAINER_KEY = Symbol.for('repkey.composition.container')

function singletonContainerExists(): boolean {
  return (globalThis as { [CONTAINER_KEY]?: unknown })[CONTAINER_KEY] !== undefined
}

async function main(): Promise<void> {
  const { container } = await createSimulationContainer({
    clock: () => FIXTURE_CLOCK_INSTANT,
    redis: undefined,
    email: async () => {},
  })

  // The exact call an event handler makes first. Before ARC-03-T8's binding
  // was extended to the simulation, THIS is what built the second container.
  const policy = getExecutionPolicy()

  const bound = boundProcessPolicies()
  const bindings = (
    ['capabilityPolicyStore', 'delayedExecutionPolicy', 'executionPolicy'] as const
  ).filter((name) => bound?.[name] === container[name])

  emitBootReport({
    deployable: 'simulation',
    // Observed, not asserted: the simulation's own container, plus a lazy
    // singleton if any policy read caused one to be built behind its back.
    containerBoots: 1 + (singletonContainerExists() ? 1 : 0),
    jobNames: [...container.jobRegistry.getAll().keys()],
    consumerNames: container.consumerRegistry.list().map((entry) => entry.consumerName),
    schedulerIds: [],
    policyBindings: bindings,
    // Names only. A policy that is not the simulation's own is the defect this
    // fixture exists to catch, so it is reported rather than assumed away.
    openHandleNames: policy === container.executionPolicy ? [] : ['foreign-policy'],
  })

  await container.shutdown?.run()
  process.exit(0)
}

void main()
