import type { GoogleConnectionId, OrganizationId, UserId } from '#/shared/domain/ids'
import type {
  GoogleConnectorDepartureCause,
  GoogleConnectorDepartureStore,
} from '../ports/google-connector-departure.port'

export type PrepareGoogleConnectorDepartureInput = Readonly<{
  organizationId: OrganizationId
  connectorUserId: UserId
  cause: GoogleConnectorDepartureCause
}>

export type PrepareGoogleConnectorDepartureDeps = Readonly<{
  store: GoogleConnectorDepartureStore
  cancelGoogleImportsForConnection: (
    organizationId: OrganizationId,
    connectionId: GoogleConnectionId,
  ) => Promise<unknown>
  clock: () => Date
}>

/**
 * Fence provider use before an AccountAdmin leaves or loses that role, then
 * converge every durable import owned by the affected connection. The fence
 * intentionally lands first: a cancellation failure can be retried without
 * ever reopening provider access.
 */
export const prepareGoogleConnectorDeparture = (
  deps: PrepareGoogleConnectorDepartureDeps,
) => {
  return async (input: PrepareGoogleConnectorDepartureInput) => {
    const result = await deps.store.fenceForDeparture({
      ...input,
      occurredAt: deps.clock(),
    })

    for (const connectionId of result.connectionIds) {
      await deps.cancelGoogleImportsForConnection(input.organizationId, connectionId)
    }

    return result
  }
}

export type PrepareGoogleConnectorDeparture = ReturnType<
  typeof prepareGoogleConnectorDeparture
>
