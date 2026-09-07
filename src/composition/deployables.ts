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
//     surface and neither worker-only nor operator-only keys leak into web.
//   * A process builds ONE complete Application Container. The second attempt
//     fails by name instead of silently producing a second policy trio, a
//     second consumer registry and a second set of queue connections.

import {
  claimProcessContainer,
  createContainer,
  releaseProcessContainer,
  type Container,
} from '#/composition'
import {
  projectContainer,
  type Deployable,
  type WebContainer,
  type WorkerContainer,
} from './container-partition'

// The partition itself lives in `./container-partition` so callers that only
// need the narrowed types do not gain the authority to build a container.
export {
  deployablesFor,
  isOperatorContainerKey,
  isOperatorOnlyKey,
  isWorkerOnlyKey,
  OPERATOR_CONTAINER_KEYS,
  OPERATOR_ONLY_KEYS,
  WORKER_ONLY_KEYS,
  type Deployable,
  type OperatorContainer,
  type OperatorContainerKey,
  type OperatorOnlyKey,
  type WebContainer,
  type WorkerContainer,
  type WorkerOnlyKey,
} from './container-partition'
export { DUPLICATE_CONTAINER_ERROR } from '#/composition'

type ApplicationDeployable = Exclude<Deployable, 'operator'>

type ContainersByDeployable = Readonly<{
  web: WebContainer
  worker: WorkerContainer
}>

export type DeployableContainerOptions = Parameters<typeof createContainer>[0]

function claimProcess<D extends ApplicationDeployable>(
  deployable: D,
  options: DeployableContainerOptions,
): ContainersByDeployable[D] {
  claimProcessContainer(deployable)
  let container: Container
  try {
    container = createContainer(options)
  } catch (error) {
    releaseProcessContainer()
    throw error
  }
  // The shutdown seam releases the process claim as well as the container's own
  // background work, so a supervised process that restarts cleanly can rebuild.
  const partition = projectContainer(container, deployable)
  const projected: Record<string, unknown> = {
    ...partition,
    shutdown: Object.freeze({
      ...container.shutdown,
      run: async () => {
        try {
          await container.shutdown.run()
        } finally {
          releaseProcessContainer()
        }
      },
    }),
  }
  return Object.freeze(projected) as ContainersByDeployable[D]
}

/** HTTP process: no worker registration, no operator repair authority. */
export function createWebContainer(options?: DeployableContainerOptions): WebContainer {
  return claimProcess('web', options)
}

/** Job/event process: registration authority and the dispatch handles. */
export function createWorkerContainer(
  options?: DeployableContainerOptions,
): WorkerContainer {
  return claimProcess('worker', { ...options, enableJobs: true })
}

