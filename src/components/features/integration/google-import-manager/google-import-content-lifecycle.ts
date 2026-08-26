export type GoogleImportClearReason =
  | 'authorization_revoked'
  | 'connection_changed'
  | 'content_expired'
  | 'lease_expired'
  | 'page_hidden'
  | 'route_left'
  | 'tenant_changed'

export class StaleGoogleImportViewError extends Error {
  constructor() {
    super('Google import content belongs to a stale view')
    this.name = 'StaleGoogleImportViewError'
  }
}

type LifecycleDependencies = Readonly<{
  cancelQueries: () => Promise<void>
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
  let clearOperation: Promise<void> | null = null
  let active = true
  let clearContent = deps.clearContent

  const clear = async (_reason: GoogleImportClearReason): Promise<void> => {
    if (clearOperation) return clearOperation
    viewEpoch += 1
    clearOperation = (async () => {
      try {
        await deps.cancelQueries()
        deps.removeQueries()
        if (active) clearContent()
      } finally {
        clearOperation = null
      }
    })()
    return clearOperation
  }

  const guard = async <T>(requestEpoch: number, operation: Promise<T>): Promise<T> => {
    const result = await operation
    if (requestEpoch !== viewEpoch) throw new StaleGoogleImportViewError()
    return result
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
