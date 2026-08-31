// Composition — one Application Container per deployable.
//
// ARC-03-T15. Beta runs exactly three kinds of process inside the single
// cell-us Data Cell:
//
//   web       serves HTTP. It must not hold worker registration authority or
//             operator repair capabilities.
//   worker    consumes jobs and durable events. It holds worker registration
//             and the dispatch handles; it serves no request.
//   operator  runs bounded, reviewed repair commands. It holds maintenance
//             capabilities but must never register consumers or schedules.
//
// Before this module the web process received the identical container shape as
// the worker, including every *WorkerRuntime and *MaintenanceRuntime key, so
// "what may this process do" had no answer expressible in code.
//
// Two guarantees:
//   * The three key sets PARTITION the container: their union is the whole
//     surface and neither worker-only nor maintenance-only keys leak into web.
//   * A process builds ONE complete Application Container. The second attempt
//     fails by name instead of silently producing a second policy trio, a
//     second consumer registry and a second set of queue connections.

import { createContainer, type Container } from '#/composition'

export type Deployable = 'web' | 'worker' | 'operator'

/** Capabilities only a job-consuming process may hold. */
const WORKER_ONLY_KEY_PATTERN = /WorkerRuntime$/u
/** Bounded operator repair capabilities. */
const MAINTENANCE_ONLY_KEY_PATTERN = /MaintenanceRuntime$/u
/** Registration authority: naming a consumer or a schedule for the process. */
const WORKER_REGISTRATION_KEYS = [
  'registerOutboxConsumers',
  'registerReviewWorkerJobs',
] as const

export const DUPLICATE_CONTAINER_ERROR =
  '[COMPOSITION] a complete Application Container already exists in this process'

function isWorkerOnly(key: string): boolean {
  return (
    WORKER_ONLY_KEY_PATTERN.test(key) ||
    (WORKER_REGISTRATION_KEYS as readonly string[]).includes(key)
  )
}

function isMaintenanceOnly(key: string): boolean {
  return MAINTENANCE_ONLY_KEY_PATTERN.test(key)
}

/** Which deployables may hold a given container key. */
export function deployablesFor(key: string): readonly Deployable[] {
  if (isWorkerOnly(key)) return ['worker']
  if (isMaintenanceOnly(key)) return ['operator']
  return ['web', 'worker', 'operator']
}

function project(container: Container, deployable: Deployable): Container {
  const projection: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(container)) {
    if (!deployablesFor(key).includes(deployable)) continue
    projection[key] = value
  }
  return Object.freeze(projection) as unknown as Container
}

/**
 * The process's one complete Application Container.
 *
 * BQC-7.1 keeps process-scoped resources (pool, queue connections) behind
 * `Symbol.for` because the production build bundles the composition module
 * twice. The same reasoning applies here: the occupancy record has to be
 * process-level, not module-level, or the second bundle would not see the
 * first bundle's container.
 */
const OCCUPANCY_KEY = Symbol.for('repkey.composition.deployable-container')

type Occupancy = Readonly<{ deployable: Deployable; container: Container }>
type OccupancyStore = { [OCCUPANCY_KEY]?: Occupancy }

function occupancyStore(): OccupancyStore {
  return globalThis as OccupancyStore
}

/** The deployable currently occupying this process, if any. */
export function occupyingDeployable(): Deployable | undefined {
  return occupancyStore()[OCCUPANCY_KEY]?.deployable
}

export type DeployableContainerOptions = Parameters<typeof createContainer>[0]

function claimProcess(
  deployable: Deployable,
  options: DeployableContainerOptions,
): Container {
  const store = occupancyStore()
  const existing = store[OCCUPANCY_KEY]
  if (existing) {
    throw new Error(`${DUPLICATE_CONTAINER_ERROR} (${existing.deployable})`)
  }
  const container = createContainer(options)
  const projection = project(container, deployable)
  // The shutdown seam releases the process claim as well as the container's own
  // background work, so a supervised process that restarts cleanly can rebuild.
  const claimed = Object.freeze({
    ...projection,
    shutdown: Object.freeze({
      ...container.shutdown,
      run: async () => {
        try {
          await container.shutdown.run()
        } finally {
          store[OCCUPANCY_KEY] = undefined
        }
      },
    }),
  }) as unknown as Container
  store[OCCUPANCY_KEY] = { deployable, container: claimed }
  return claimed
}

/** HTTP process: no worker registration, no operator repair authority. */
export function createWebContainer(options?: DeployableContainerOptions): Container {
  return claimProcess('web', options)
}

/** Job/event process: registration authority and the dispatch handles. */
export function createWorkerContainer(options?: DeployableContainerOptions): Container {
  return claimProcess('worker', { ...options, enableJobs: true })
}

/** Bounded reviewed repair process: maintenance, never registration. */
export function createOperatorContainer(options?: DeployableContainerOptions): Container {
  return claimProcess('operator', options)
}
