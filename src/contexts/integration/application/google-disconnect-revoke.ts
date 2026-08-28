import type { GoogleConnection } from '../domain/types'
import type { IntegrationGoogleAccountDisconnected } from '../domain/events'
import type { GoogleDisconnectRevokeAuthorization } from './google-provider-contract'

export const GOOGLE_DISCONNECT_REVOKE_WINDOW_MS = 60_000

export type GoogleDisconnectRevokeOutcome =
  'confirmed_not_sent' | 'confirmed_revoked' | 'cleanup_ambiguous'

export type GoogleDisconnectRevokeResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false
      code:
        | 'not_found'
        | 'scope_mismatch'
        | 'invalid_transition'
        | 'deadline_exceeded'
        | 'concurrent_attempt'
    }>

export type GoogleDisconnectRevokePrepareInput = Readonly<{
  attemptId: string
  authorization: GoogleDisconnectRevokeAuthorization
  credentialBinding: string
  cleanupDeadlineAt: Date
  now: Date
}>

export type GoogleDisconnectRevokeStore = Readonly<{
  prepare(
    input: GoogleDisconnectRevokePrepareInput,
  ): Promise<GoogleDisconnectRevokeResult<{ prepared: true }>>
  acquireDispatch(
    input: Readonly<{
      attemptId: string
      cleanupWorkPermitId: string
      authorization: GoogleDisconnectRevokeAuthorization
      credentialBinding: string
      now: Date
    }>,
  ): Promise<GoogleDisconnectRevokeResult<{ dispatching: true }>>
  settle(
    input: Readonly<{
      attemptId: string
      organizationId: string
      connectionId: string
      initiatorUserId: string
      outcome: GoogleDisconnectRevokeOutcome
      outcomeCode: string
      event: IntegrationGoogleAccountDisconnected
      now: Date
    }>,
  ): Promise<GoogleDisconnectRevokeResult<GoogleConnection>>
  /**
   * Bounded recovery over attempts whose provider-send window elapsed. It
   * never retries a revoke: an unstarted permit proves not-sent; any started
   * permit is conservatively recorded as ambiguous before local redaction.
   */
  reconcileElapsed(input: Readonly<{ now: Date; limit: number }>): Promise<
    Readonly<{
      visited: number
      confirmedNotSent: number
      cleanupAmbiguous: number
    }>
  >
}>

export type GoogleDisconnectRevokeDispatchHooks = Readonly<{
  prepare: GoogleDisconnectRevokeStore['prepare']
  acquireDispatch: GoogleDisconnectRevokeStore['acquireDispatch']
}>
