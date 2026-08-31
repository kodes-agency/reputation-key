import type { GoogleConnectionId, OrganizationId, UserId } from '#/shared/domain/ids'

export type GoogleConnectorDepartureCause = 'member_removed' | 'account_admin_role_lost'

export type GoogleConnectorDepartureFenceInput = Readonly<{
  organizationId: OrganizationId
  connectorUserId: UserId
  cause: GoogleConnectorDepartureCause
  occurredAt: Date
}>

export type GoogleConnectorDepartureFenceResult = Readonly<{
  /** Every still-credentialed connection whose current OAuth grant belongs to the user. */
  connectionIds: readonly GoogleConnectionId[]
  /** The subset moved to reauthorization-required by this invocation. */
  transitionedConnectionIds: readonly GoogleConnectionId[]
}>

/**
 * Atomic Integration-owned authority for connector offboarding. Implementations
 * fence provider use and commit one identifier-only lifecycle fact per newly
 * transitioned connection before returning.
 */
export type GoogleConnectorDepartureStore = Readonly<{
  fenceForDeparture(
    input: GoogleConnectorDepartureFenceInput,
  ): Promise<GoogleConnectorDepartureFenceResult>
}>
