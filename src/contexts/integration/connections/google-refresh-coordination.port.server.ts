import type { GoogleConnectionId, OrganizationId } from '#/shared/domain/ids'

export type GoogleRefreshCoordinationDenyCode =
  | 'backoff_active'
  | 'coordination_unavailable'
  | 'key_collision'
  | 'coordination_deadline_exceeded'
  | 'leadership_lost'

export type GoogleRefreshCoordinationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false
      code: GoogleRefreshCoordinationDenyCode
      retryAfterMs: number
    }>

/**
 * Replica-safe credential refresh boundary. The implementation owns opaque
 * Redis keys, a renewable fenced lease, and shared provider-failure backoff.
 * The application supplies only database re-read and refresh/commit actions.
 */
export type GoogleRefreshCoordination = Readonly<{
  run<T>(
    input: Readonly<{
      organizationId: OrganizationId
      connectionId: GoogleConnectionId
      expectedCredentialGeneration: number
      deadlineMs: number
      loadLatest: () => Promise<T | null>
      refresh: (assertLeadership: () => Promise<void>) => Promise<T>
    }>,
  ): Promise<GoogleRefreshCoordinationResult<T>>
}>
