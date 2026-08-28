// ARC-03-T15 — the WORKER deployable, booted in its own process.
//
// Proves the claim the shared vitest worker cannot: one Application Container,
// its OWN durable consumer registry (ARC-03-T7), and a deterministic
// registration set. Two runs must produce byte-identical reports — a difference
// would mean registration depends on iteration or module-load order.

import { createWorkerContainer } from '#/composition/deployables'
import { bindProcessPolicies } from '#/shared/auth/process-policy-binding'
import { emitBootReport } from './boot-report'
import { deterministicContainerOptions, openHandleNames } from './fixture-runtime'

async function main(): Promise<void> {
  const container = createWorkerContainer(deterministicContainerOptions())

  // ARC-03-T8: the worker's ONE explicit policy installation. Building a
  // container installs nothing process-wide.
  bindProcessPolicies(container)
  container.registerOutboxConsumers()

  emitBootReport({
    deployable: 'worker',
    containerBoots: 1,
    jobNames: [...container.jobRegistry.getAll().keys()],
    consumerNames: container.consumerRegistry.list().map((entry) => entry.consumerName),
    schedulerIds: [],
    policyBindings: [
      'capabilityPolicyStore',
      'executionPolicy',
      'delayedExecutionPolicy',
    ],
    openHandleNames: openHandleNames(container),
  })

  // Release the container's background work (the identity policy poller keeps
  // the event loop alive) and exit deliberately.
  await container.shutdown.run()
  process.exit(0)
}

void main()
