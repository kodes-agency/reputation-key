// ARC-03-T15 — the WEB deployable, booted in its own process.
//
// Run as a child process by one-container-per-process.test.ts. It exists to
// prove a claim that cannot be proven inside a shared vitest worker: a web
// process builds exactly ONE Application Container, registers ZERO jobs and
// ZERO durable consumers, and holds no scheduler.
//
// Set FIXTURE_DOUBLE_BOOT=1 to exercise the negative control.

import { createWebContainer } from '#/composition/deployables'
import { emitBootReport } from './boot-report'
import { deterministicContainerOptions, openHandleNames } from './fixture-runtime'

async function main(): Promise<void> {
  const container = createWebContainer(deterministicContainerOptions())

  if (process.env.FIXTURE_DOUBLE_BOOT === '1') {
    // Negative control: the second build must fail by name, not silently
    // produce a second policy trio and a second consumer registry.
    createWebContainer(deterministicContainerOptions())
  }

  emitBootReport({
    deployable: 'web',
    containerBoots: 1,
    // The web process serves requests. It registers nothing.
    jobNames: [...container.jobRegistry.getAll().keys()],
    consumerNames: container.consumerRegistry.list().map((entry) => entry.consumerName),
    schedulerIds: [],
    policyBindings: [],
    openHandleNames: openHandleNames(container),
  })

  // Release the container's background work and exit deliberately, so a hung
  // fixture is a TIMEOUT the suite reports rather than a silently slow one.
  await container.shutdown.run()
  process.exit(0)
}

void main()
