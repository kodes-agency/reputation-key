/**
 * Why provider content left the browser. Hiding the tab is deliberately not a
 * reason: the page keeps its selection while the authorization lease is renewed
 * in the background, and clears only when access, scope, or a deadline ends
 * (ADR 0050 §3, amended 2026-09-15).
 */
export type GoogleImportClearReason =
  | 'authorization_revoked'
  | 'connection_changed'
  | 'content_expired'
  | 'lease_expired'
  | 'route_left'
  | 'tenant_changed'

export type GoogleImportViewCompletion<T> =
  | Readonly<{
      _tag: 'current_google_import_view'
      value: T
    }>
  | Readonly<{
      _tag: 'stale_google_import_view'
      clearReason: GoogleImportClearReason
      currentEpoch: number
      requestEpoch: number
    }>

type LifecycleDependencies = Readonly<{
  /** Removes the provider-content queries; removal cancels any in-flight fetch. */
  removeQueries: () => void
  clearContent: () => void
  /** Runs `run` after the current task; returns a cancel. Tests inject their own. */
  schedule?: (run: () => void) => () => void
}>

function scheduleAfterCurrentTask(run: () => void): () => void {
  const timeout = setTimeout(run, 0)
  return () => clearTimeout(timeout)
}

const MAX_TIMER_DELAY_MS = 2_147_483_647

export function contentExpiryDelayMs(expiresAt: string, nowMs: number): number {
  const expiresAtMs = Date.parse(expiresAt)
  if (!Number.isFinite(expiresAtMs)) return 0
  return Math.min(MAX_TIMER_DELAY_MS, Math.max(0, expiresAtMs - nowMs))
}

export function createGoogleImportContentLifecycle(deps: LifecycleDependencies) {
  let viewEpoch = 0
  let active = true
  let clearContent = deps.clearContent
  let cancelPendingLeave: (() => void) | null = null
  const schedule = deps.schedule ?? scheduleAfterCurrentTask
  const invalidationReasons: GoogleImportClearReason[] = []

  // Synchronous on purpose. Removing a query destroys it, which cancels an
  // in-flight fetch, so nothing here needs to await. An earlier version awaited
  // a cancel first and only then checked `active`: React StrictMode runs the
  // owning effect's cleanup (deactivate + clear) and immediately re-mounts
  // (activate), so the deferred check saw an active view and cleared the
  // state of a page that was never left. On the progress route that reset the
  // step to discovery, and the import the user had just started vanished
  // behind a "location details were cleared" notice.
  const clear = (reason: GoogleImportClearReason): void => {
    invalidationReasons[viewEpoch] = reason
    viewEpoch += 1
    deps.removeQueries()
    if (active) clearContent()
  }

  const guard = async <T>(
    requestEpoch: number,
    operation: Promise<T>,
  ): Promise<GoogleImportViewCompletion<T>> => {
    const result = await operation
    if (requestEpoch === viewEpoch) {
      return { _tag: 'current_google_import_view', value: result }
    }
    const clearReason = invalidationReasons[requestEpoch]
    if (clearReason === undefined) {
      throw new TypeError('Google import view epoch is invalid')
    }
    return {
      _tag: 'stale_google_import_view',
      clearReason,
      currentEpoch: viewEpoch,
      requestEpoch,
    }
  }

  return Object.freeze({
    epoch: () => viewEpoch,
    activate: () => {
      active = true
      cancelPendingLeave?.()
      cancelPendingLeave = null
    },
    deactivate: () => {
      active = false
    },
    /**
     * The owning view unmounted. StrictMode and Fast Refresh unmount a view and
     * mount it again at once, keeping this lifecycle and the view's own epoch.
     * Clearing right away advanced the lifecycle past that epoch, so every
     * answer the re-mounted view then fetched came back stale and was dropped:
     * the connected account's Business Profile accounts read as "none found"
     * until a reload. The clear waits one task, and an activation in between
     * (the re-mount) cancels it; a view that really left is cleared as before.
     */
    leave: () => {
      active = false
      cancelPendingLeave?.()
      cancelPendingLeave = schedule(() => {
        cancelPendingLeave = null
        clear('route_left')
      })
    },
    setClearContent: (next: () => void) => {
      clearContent = next
    },
    clear,
    guard,
  })
}
