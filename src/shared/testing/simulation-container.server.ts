// Simulation container — builds a container with deterministic backends for
// testing and simulation (ADR 0019).
//
// Uses the REAL event bus (so event handlers fire synchronously in-process)
// and an in-memory queue (so jobs are recorded and optionally processed inline,
// no Redis required). The clock is injectable for fast-forward time.
//
// The DB is still real by default — for ephemeral isolation, pass a per-run
// Database override. Identity and externals are still real (better-auth, Google,
// Resend) unless overridden — Track 4 adds those fakes.

import { createContainer, type Container } from '#/composition'
import { bootstrap } from '#/bootstrap'
import { createInMemoryQueue, type InMemoryQueue } from './in-memory-queue'
import type { Clock } from '#/shared/domain/clock'
import type { Database } from '#/shared/db'
import type { Redis } from 'ioredis'
import type { EventBus } from '#/shared/events/event-bus'
import type { IdentityPort } from '#/contexts/identity/application/ports/identity.port'
import type { sendInvitationEmail as SendInvitationEmail } from '#/shared/auth/emails'

export type SimulationContainerOptions = {
  /** Controllable clock — advance it to trigger time-dependent jobs. */
  clock?: Clock
  /** Override the DB (ephemeral isolation). Defaults to the prod singleton. */
  db?: Database
  /** Override Redis. Pass undefined to skip Redis entirely. */
  redis?: Redis
  /** Override the event bus. Defaults to a fresh real bus (handlers fire). */
  eventBus?: EventBus
  /** Override the identity port (in-memory identity for logic sims). */
  identityPort?: IdentityPort
  /** Override the email sender (capture emails instead of sending). */
  email?: typeof SendInvitationEmail
}

export type SimulationHandle = Readonly<{
  container: Container
  /** The in-memory queue — inspect enqueuedJobs / processedJobs for assertions. */
  queue: InMemoryQueue
  /** Advance the simulation clock and trigger time-dependent jobs. */
  advanceClock: (ms: number) => void
}>

export async function createSimulationContainer(
  options?: SimulationContainerOptions,
): Promise<SimulationHandle> {
  let currentTime = options?.clock ? options.clock() : new Date()
  const clock: Clock = () => currentTime

  // 1. Create in-memory queue (registry connected after bootstrap)
  const queue = createInMemoryQueue({ clock })

  // 2. Build the container with deterministic backends
  const container = createContainer({
    clock,
    db: options?.db,
    redis: options?.redis,
    eventBus: options?.eventBus,
    identityPort: options?.identityPort,
    email: options?.email,
    queue,
    enableJobs: true,
  })

  // 3. Register all event handlers + job handlers
  await bootstrap(container)

  // 4. Connect the queue to the registry so jobs process inline
  queue.connectRegistry(container.jobRegistry)

  return {
    container,
    queue,
    advanceClock(ms: number) {
      currentTime = new Date(currentTime.getTime() + ms)
    },
  }
}
