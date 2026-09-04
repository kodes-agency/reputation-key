// ARC-03-T16: which container keys belong to which process kind, and the three
// narrowed container types that follow from it.
//
// This module is deliberately SEPARATE from `deployables.ts`. That file may
// BUILD a complete Application Container for one process kind, so the boundary
// rules let only the top-level entry points and the process fixtures import it.
// Knowing the partition is not the same authority as being able to construct
// it: the composition root, the worker bootstrap and the operator harness all
// need the narrowed types to declare honest signatures, and none of them should
// gain a second container builder to get them.
import type { Container } from '#/composition'

export type Deployable = 'web' | 'worker' | 'operator'

/** Capabilities only a job-consuming process may hold. */
export const WORKER_ONLY_KEYS = [
  'aiWorkerRuntime',
  'jobDispatchWorkerRuntime',
  'portalWorkerRuntime',
  'identityWorkerRuntime',
  'integrationWorkerRuntime',
  'goalWorkerRuntime',
  'activityWorkerRuntime',
  'notificationWorkerRuntime',
  'registerOutboxConsumers',
  'registerReviewWorkerJobs',
] as const satisfies readonly (keyof Container)[]

/** Bounded operator repair capabilities. */
export const OPERATOR_ONLY_KEYS = [
  'reviewMaintenanceRuntime',
  'integrationMaintenanceRuntime',
  'inboxMaintenanceRuntime',
  'metricMaintenanceRuntime',
] as const satisfies readonly (keyof Container)[]

/**
 * The complete operator surface. Unlike web and worker, the short-lived
 * operator process gets an allowlist: database, queue, policy diagnostics and
 * the reviewed maintenance interfaces used by scripts/ops.
 */
export const OPERATOR_CONTAINER_KEYS = [
  'backgroundQueue',
  'clock',
  'db',
  'identityLifecycleRuntime',
  'inboxMaintenanceRuntime',
  'integrationMaintenanceRuntime',
  'integrationPublicApi',
  'jobQueue',
  'metricMaintenanceRuntime',
  'opsQueues',
  'policyAdmin',
  'reviewMaintenanceRuntime',
  'shutdown',
] as const satisfies readonly (keyof Container)[]

export type WorkerOnlyKey = (typeof WORKER_ONLY_KEYS)[number]
export type OperatorOnlyKey = (typeof OPERATOR_ONLY_KEYS)[number]
export type OperatorContainerKey = (typeof OPERATOR_CONTAINER_KEYS)[number]

export type WebContainer = Omit<Container, WorkerOnlyKey | OperatorOnlyKey>
export type WorkerContainer = Omit<Container, OperatorOnlyKey>
export type OperatorContainer = Pick<Container, OperatorContainerKey>

export function isWorkerOnlyKey(key: string): key is WorkerOnlyKey {
  return (WORKER_ONLY_KEYS as readonly string[]).includes(key)
}

export function isOperatorOnlyKey(key: string): key is OperatorOnlyKey {
  return (OPERATOR_ONLY_KEYS as readonly string[]).includes(key)
}

export function isOperatorContainerKey(key: string): key is OperatorContainerKey {
  return (OPERATOR_CONTAINER_KEYS as readonly string[]).includes(key)
}

/** Which process kinds may hold a given container key. */
export function deployablesFor(key: string): readonly Deployable[] {
  if (isWorkerOnlyKey(key)) return ['worker']
  if (isOperatorOnlyKey(key)) return ['operator']
  return isOperatorContainerKey(key) ? ['web', 'worker', 'operator'] : ['web', 'worker']
}

/**
 * Narrow a complete container to one process kind.
 *
 * Pure: it drops keys, it never constructs anything, so a caller that can
 * project is not a caller that can build a second container.
 */
export function projectContainer<D extends Deployable>(
  container: Container,
  deployable: D,
): D extends 'web'
  ? WebContainer
  : D extends 'worker'
    ? WorkerContainer
    : OperatorContainer {
  const projection: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(container)) {
    if (!deployablesFor(key).includes(deployable)) continue
    projection[key] = value
  }
  return Object.freeze(projection) as never
}

/**
 * The process's one Application Container claim.
 *
 * BQC-7.1 keeps process-scoped resources behind `Symbol.for` because the
 * production build bundles the composition module twice. The same reasoning
 * applies here: the occupancy record has to be process-level, not module-level,
 * or the second bundle would not see the first bundle's container.
 *
 * It lives beside the partition rather than beside the builders so the web
 * singleton — which projects rather than builds — still claims the process.
 */
const OCCUPANCY_KEY = Symbol.for('repkey.composition.deployable-container')

type OccupancyStore = { [OCCUPANCY_KEY]?: Readonly<{ deployable: Deployable }> }

function occupancyStore(): OccupancyStore {
  return globalThis as OccupancyStore
}

/** The deployable currently occupying this process, if any. */
export function occupyingDeployable(): Deployable | undefined {
  return occupancyStore()[OCCUPANCY_KEY]?.deployable
}

export const DUPLICATE_CONTAINER_ERROR =
  '[COMPOSITION] a complete Application Container already exists in this process'

/** Record the claim, refusing a second container in the same process. */
export function claimDeployable(deployable: Deployable): void {
  const store = occupancyStore()
  const existing = store[OCCUPANCY_KEY]
  if (existing) {
    throw new Error(`${DUPLICATE_CONTAINER_ERROR} (${existing.deployable})`)
  }
  store[OCCUPANCY_KEY] = Object.freeze({ deployable })
}

/** Release the claim so a supervised process that restarts can rebuild. */
export function releaseDeployableClaim(): void {
  occupancyStore()[OCCUPANCY_KEY] = undefined
}
