// ARC-03-T15 — shared, deterministic setup for the process fixtures.
//
// Every fixture boots with the SAME injected environment, clock, queues and
// identity port, so two runs of the same deployable produce byte-identical boot
// reports and a difference between reports is a real difference in composition.
//
// No network, no Redis, no provider: `redis: undefined` explicitly disables
// ambient Redis, and every queue handle is in-memory.

import type { WebContainer, WorkerContainer } from '#/composition/deployables'
import type { Clock } from '#/shared/domain/clock'
import { createInMemoryQueue } from '#/shared/testing/in-memory-queue'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'

export const FIXTURE_CLOCK_INSTANT = new Date('2026-01-15T12:00:00.000Z')

export function deterministicContainerOptions() {
  const clock: Clock = () => FIXTURE_CLOCK_INSTANT
  return {
    clock,
    queue: createInMemoryQueue({ clock }),
    backgroundQueue: createInMemoryQueue({ clock }),
    opsDomainEventsQueue: createInMemoryQueue({ clock }),
    opsQuarantineQueue: createInMemoryQueue({ clock }),
    opsBackgroundQueue: createInMemoryQueue({ clock }),
    redis: undefined,
    identityPort: createInMemoryIdentityPort(),
    email: async () => {},
    // ARC-03-T14: in-process provider runtimes read this instead of ambient
    // process state, so the fixture's environment is the whole environment.
    runtimeEnvironment: {},
    /** ARC-03-T13: no server request exists in a fixture process. */
    requestContext: { currentRequestHeaders: async () => new Headers() },
    authSession: {
      setActiveOrganization: async () => {},
      updateOrganization: async () => {},
      currentOrganizationName: async () => null,
      verifyPassword: async () => false,
    },
  } as const
}

/**
 * Named long-lived handles the container holds. Names only — a handle's
 * configuration is never part of a boot report.
 */
export function openHandleNames(
  container: WebContainer | WorkerContainer,
): readonly string[] {
  const names: string[] = []
  if (container.db) names.push('database')
  if (container.pool) names.push('database-pool')
  if (container.redis) names.push('redis')
  if (container.jobQueue) names.push('job-queue')
  if (container.backgroundQueue) names.push('background-queue')
  if (container.providerEphemeralRedis) names.push('provider-ephemeral-redis')
  return names
}
