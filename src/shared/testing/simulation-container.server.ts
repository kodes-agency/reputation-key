// Simulation container — builds a container with deterministic backends for
// testing and simulation (ADR 0019).
//
// Uses the REAL event bus (so event handlers fire synchronously in-process)
// and an in-memory queue (so jobs are recorded and optionally processed inline,
// no Redis required). The clock is injectable for fast-forward time.
//
// The DB is still real by default — for ephemeral isolation, pass a per-run
// Database override. Identity and externals (better-auth, Google, Resend) are
// real unless overridden — BQC-6.1 delivers the full set of fakes: pass
// identityPort/email plus providers { googleOAuth, gbpApi, storage } (the
// in-memory fakes in this directory) for a network-free simulation.

import {
  createContainer,
  type ProviderOverrides,
  type SimulationContainer,
} from '#/composition'
import { bootstrap, createBootstrapRuntimeConfig } from '#/bootstrap'
import {
  bindProcessPolicies,
  releaseProcessPolicies,
  type ProcessPolicyBundle,
} from '#/shared/auth/process-policy-binding'
import { createInMemoryQueue, type InMemoryQueue } from './in-memory-queue'
import type { Clock } from '#/shared/domain/clock'
import type { Database } from '#/shared/db'
import type { Redis } from 'ioredis'
import type { EventBus } from '#/shared/events/event-bus'
import type { IdentityPort } from '#/contexts/identity/application/ports/identity.port'
import type { sendInvitationEmail as SendInvitationEmail } from '#/shared/auth/emails'
import { getEnv, type Env } from '#/shared/config/env'

export type SimulationContainerOptions = {
  /** Controllable clock — advance it to trigger time-dependent jobs. */
  clock?: Clock
  /** Override the DB (ephemeral isolation). Defaults to the prod singleton. */
  db?: Database
  /** Override Redis. Omit the option to use ambient Redis; pass undefined to skip it. */
  redis?: Redis
  /** Override the event bus. Defaults to a fresh real bus (handlers fire). */
  eventBus?: EventBus
  /** Override the identity port (in-memory identity for logic sims). */
  identityPort?: IdentityPort
  /** Override the email sender (capture emails instead of sending). */
  email?: typeof SendInvitationEmail
  /** Override external provider adapters (BQC-6.1: in-memory googleOAuth /
   * gbpApi / storage for a network-free simulation). */
  providers?: ProviderOverrides
  /** Validated process configuration override for deterministic simulations. */
  env?: Env
}

export type SimulationHandle = Readonly<{
  container: SimulationContainer
  /** The in-memory queue — inspect enqueuedJobs / processedJobs for assertions. */
  queue: InMemoryQueue
  /** Advance the simulation clock and trigger time-dependent jobs. */
  advanceClock: (ms: number) => void
}>

/**
 * ARC-03-T8: the simulation's ONE explicit policy installation.
 *
 * Building a container no longer installs the policy trio, and a simulation is
 * a process like any other — so it has to name its installation point the way
 * the worker (src/worker/index.ts) and the operator harness do. Without this
 * the first policy-gated read inside an event handler fell through to the WEB
 * cold-boot fallback, which builds a SECOND container from ambient env:
 *
 *   - in a process with a full `.env` that quietly succeeded, and every gated
 *     handler decision was then answered by a different container's audit sink
 *     and consent reader than the one the simulation was exercising;
 *   - in a process without one (CI, which sets only the eight vars the job
 *     declares) the ambient build threw, so EVERY event handler threw and the
 *     projections they own — Inbox items above all — were simply never made.
 *
 * A test process builds many simulation containers in sequence, so a previous
 * simulation-owned binding is released first. The release is conditional on
 * the bundle, so a competing worker/web/operator installation still fails
 * loudly at the bind below — which is the whole point of the guard.
 */
let simulationPolicies: ProcessPolicyBundle | undefined

function bindSimulationProcessPolicies(policies: ProcessPolicyBundle): void {
  if (simulationPolicies) releaseProcessPolicies(simulationPolicies)
  simulationPolicies = policies
  bindProcessPolicies(policies)
}

export async function createSimulationContainer(
  options?: SimulationContainerOptions,
): Promise<SimulationHandle> {
  let currentTime = options?.clock ? options.clock() : new Date()
  const clock: Clock = () => currentTime
  const env = options?.env ?? getEnv()

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
    providers: options?.providers,
    env,
    queue,
    enableJobs: true,
    exposeSimulationRuntime: true,
  })
  if (!container.simulationRuntime) {
    throw new Error('Simulation mutation capabilities were not composed')
  }
  const simulationContainer = container as SimulationContainer

  // 3. Make THIS container the process policy answer, before bootstrap runs
  //    anything gated and before the first event dispatch.
  bindSimulationProcessPolicies(simulationContainer)

  // 4. Register all event handlers + job handlers
  await bootstrap(simulationContainer, {
    runtime: createBootstrapRuntimeConfig(env),
    allowUnavailableGoogleImportV2Processor: true,
  })

  // 5. Connect the queue to the registry so jobs process inline
  queue.connectRegistry(simulationContainer.jobRegistry)

  return {
    container: simulationContainer,
    queue,
    advanceClock(ms: number) {
      currentTime = new Date(currentTime.getTime() + ms)
    },
  }
}
