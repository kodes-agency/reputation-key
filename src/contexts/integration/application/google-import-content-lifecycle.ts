export type GoogleImportClearReason =
  | 'authorization_revoked'
  | 'connection_changed'
  | 'content_expired'
  | 'lease_expired'
  | 'page_hidden'
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
}>

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
    },
    deactivate: () => {
      active = false
    },
    setClearContent: (next: () => void) => {
      clearContent = next
    },
    clear,
    guard,
  })
}
