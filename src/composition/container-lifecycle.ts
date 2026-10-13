// ARC-03-T6 — the container's owned shutdown seam.
//
// RULE: every process-lifetime resource a container starts must be reachable
// from that container's own shutdown capability.
//
// WHY: building a container used to start background work (the identity
// policy-store poller, POLICY_REFRESH_INTERVAL_MS) whose stop function was
// returned to the identity build and then dropped. Neither closeContainer()
// nor the web graceful-shutdown plugin nor the worker drain could reach it,
// so every container built in a process leaked a live interval and an
// unawaited database refresh. A container that cannot be proved to stop what
// it started cannot be proved process-scoped, which is the precondition for
// retiring the remaining process globals.
//
// STATE (2026-10-13): the rule is not held for connections, and the seam is
// empty. No build starts background work any more (the poller above is gone),
// so the shutdown capability is built from an empty hook list
// (operational-readout.ts) and `run()` releases nothing. The queue and Redis
// connections a container opens, the operational readout's quarantine read
// handle, job-runtime observation connection and worker barrier queue
// included, are released elsewhere: the web process quits every tracked
// connection through closeJobQueueConnections() (shared/jobs/queue.ts), the
// worker closes the queues it names in its drain and then exits, and a
// container built directly (a simulation, an operator command) leaves them to
// its process's exit. Register a hook here before a build starts background
// work again; do not read this seam as covering a resource it was never given.
//
// The seam is deliberately tiny: ONE key (`run`), frozen, idempotent. Hooks
// run in registration order and a throwing hook never prevents the rest from
// running — a shutdown path that aborts halfway leaks exactly the resources
// this module exists to release.

/** Narrow logging surface (pino satisfies this). */
export type ContainerShutdownLogger = Readonly<{
  error: (fields: Readonly<Record<string, unknown>>, message: string) => void
}>

export type ContainerShutdownHook = Readonly<{
  /** Diagnostic label — appears in the log line when the hook throws. */
  label: string
  release: () => void | Promise<void>
}>

/**
 * The container-owned shutdown capability. Exactly one key so the container
 * surface cannot grow an ad-hoc lifecycle API by accretion.
 */
export type ContainerShutdown = Readonly<{
  run: () => Promise<void>
}>

/**
 * Build the shutdown capability from the hooks the container registered while
 * composing. `run()` is idempotent: the first call owns the release sequence
 * and every later call awaits that same promise, so a worker drain racing the
 * web plugin (or a double SIGTERM) never releases twice.
 */
export function createContainerShutdown(
  hooks: ReadonlyArray<ContainerShutdownHook>,
  logger?: ContainerShutdownLogger,
): ContainerShutdown {
  let inFlight: Promise<void> | undefined

  const releaseAll = async (): Promise<void> => {
    for (const hook of hooks) {
      try {
        await hook.release()
      } catch (err) {
        // Abandoning the remaining hooks would leak the very resources this
        // seam exists to release, so a failure is recorded and skipped.
        logger?.error({ err, hook: hook.label }, 'Container shutdown hook failed')
      }
    }
  }

  return Object.freeze({
    run: (): Promise<void> => {
      inFlight ??= releaseAll()
      return inFlight
    },
  })
}
