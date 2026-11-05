// The container's process lifecycle and its one disposer.
//
// A process is `starting` until its container is built, `ready` once it is,
// `draining` from the moment shutdown begins, and `failed` after a build or a
// release that did not complete. `draining` and `failed` are terminal: nothing
// rebuilds a container once shutdown has begun, and a build that failed is not
// retried by request traffic, because every attempt opens Redis connections
// that nothing would close. The state lives on `globalThis` behind `Symbol.for`
// because the production build bundles the composition root twice.
//
// Release is the reverse of acquisition: the handles a container opened close
// before the shared queue connections under them, and every release runs even
// when an earlier one fails. A failed release is reported once the rest have
// run, so the process can exit nonzero.

import { disposeResources } from '#/shared/lifecycle/disposer'
import { closeJobQueueConnections } from '#/shared/jobs/queue'

export type ContainerShutdownLogger = Readonly<{
  error: (fields: Readonly<Record<string, unknown>>, message: string) => void
}>

export type ContainerShutdownHook = Readonly<{
  label: string
  release: () => void | Promise<unknown>
}>

export type ContainerShutdown = Readonly<{ run: () => Promise<void> }>

/**
 * Build the disposer from hooks registered in acquisition order. `run()` is
 * idempotent: the first call owns the release sequence and later calls await the
 * same promise, so a worker drain racing the web plugin never releases twice.
 * Every hook runs, even after one fails; the promise then rejects.
 */
export function createContainerShutdown(
  hooks: ReadonlyArray<ContainerShutdownHook>,
  logger?: ContainerShutdownLogger,
): ContainerShutdown {
  let inFlight: Promise<void> | undefined
  return Object.freeze({
    run: (): Promise<void> => {
      inFlight ??= disposeResources(
        [...hooks].reverse().map((hook) => [hook]),
        {
          onError: (err, label) =>
            logger?.error({ err, hook: label }, 'Container shutdown hook failed'),
        },
      ).then(({ failed }) => {
        if (failed.length) throw new AggregateError(failed, 'Container shutdown failed')
      })
      return inFlight
    },
  })
}

type LifecycleState = 'starting' | 'ready' | 'draining' | 'failed'
const LIFECYCLE_KEY = Symbol.for('repkey.composition.lifecycle')
type Lifecycle = { state: LifecycleState; closing?: Promise<void>; failure?: unknown }
function lifecycle(): Lifecycle {
  const store = globalThis as { [LIFECYCLE_KEY]?: Lifecycle }
  return (store[LIFECYCLE_KEY] ??= { state: 'starting' })
}

export function containerLifecycleState(): LifecycleState {
  return lifecycle().state
}

/** Throws once shutdown has begun or a build or release failed; the cause rides along. */
export function assertContainerCanBuild(): void {
  const { state, failure } = lifecycle()
  if (state === 'draining') throw new Error('Container is draining')
  if (state === 'failed') throw new Error('Container is failed', { cause: failure })
}

export function markContainerReady(): void {
  if (lifecycle().state === 'starting') lifecycle().state = 'ready'
}

export function markContainerFailed(cause?: unknown): void {
  const current = lifecycle()
  current.state = 'failed'
  current.failure ??= cause
}

export function beginContainerDrain(): void {
  if (lifecycle().state !== 'failed') lifecycle().state = 'draining'
}

/** One release per process; the promise is shared with separately bundled composition roots. */
export function closeProcessContainer(release: () => Promise<void>): Promise<void> {
  const current = lifecycle()
  return (current.closing ??= Promise.resolve()
    .then(release)
    .then(() => {
      // An explicit teardown (a benchmark's restart) may build again; draining is terminal.
      if (current.state !== 'draining' && current.state !== 'failed') {
        current.state = 'starting'
        current.closing = undefined
      }
    })
    .catch((error: unknown) => {
      markContainerFailed(error)
      throw error
    }))
}

/**
 * The disposer for a container's own handles: what it opened closes before the
 * shared queue connections under it. Given handles without a `shutdown`, it
 * releases those alone, so a bare or never-built singleton still closes cleanly.
 */
export function createContainerDisposer(
  container: {
    shutdown?: ContainerShutdown
    jobQueue?: { close(): Promise<void> }
    backgroundQueue?: { close(): Promise<void> }
    providerEphemeralRedis?: { quit(): Promise<unknown> }
    opsQueues?: { domainEvents?: { close(): Promise<void> } }
  },
  logger?: ContainerShutdownLogger,
): ContainerShutdown {
  return createContainerShutdown(
    [
      { label: 'queue-connections', release: closeJobQueueConnections },
      { label: 'default-queue', release: () => container.jobQueue?.close() },
      { label: 'background-queue', release: () => container.backgroundQueue?.close() },
      {
        label: 'domain-events',
        release: () => container.opsQueues?.domainEvents?.close(),
      },
      {
        label: 'provider-redis',
        release: () => container.providerEphemeralRedis?.quit(),
      },
      { label: 'container', release: () => container.shutdown?.run() },
    ],
    logger,
  )
}
