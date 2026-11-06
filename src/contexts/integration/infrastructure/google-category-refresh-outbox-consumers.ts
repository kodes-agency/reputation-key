import type { ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import type { GoogleConnectionRepository } from '../application/ports/google-connection.repository'
import type { createRefreshBoundGoogleCategories } from '../application/refresh-bound-google-categories'
import type { ActiveMemberAuthResolver } from './active-member-auth.adapter'

export const GOOGLE_CATEGORY_REFRESH_CONSUMER = 'integration.google-category-refresh'

export function registerGoogleCategoryRefreshConsumer(
  registry: ConsumerRegistry,
  deps: Readonly<{
    findConnection: GoogleConnectionRepository['findById']
    resolveActor: ActiveMemberAuthResolver
    refresh: ReturnType<typeof createRefreshBoundGoogleCategories>
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>,
): void {
  registry.registerConsumer({
    eventType: 'integration.google_account.connected',
    consumerName: GOOGLE_CATEGORY_REFRESH_CONSUMER,
    module: GOOGLE_CATEGORY_REFRESH_CONSUMER,
    handler: async (event) => {
      const payload = validateEventPayload(
        event.eventType,
        event.eventVersion,
        event.payload,
      ) as {
        organizationId: string
        connectionId: string
        userId?: string
        connectedBy?: string
      }
      if (
        !payload ||
        event.eventType !== 'integration.google_account.connected' ||
        payload.organizationId !== event.organizationId ||
        payload.connectionId !== event.sourceAggregateId
      ) {
        throw new Error('Google category refresh attribution mismatch')
      }
      const connection = await deps.findConnection(
        organizationId(payload.organizationId),
        googleConnectionId(payload.connectionId),
      )
      const initiator = payload.userId ?? payload.connectedBy
      const actor = initiator
        ? await deps.resolveActor(payload.organizationId, initiator)
        : null
      let status: 'applied' | 'obsolete' = 'obsolete'
      if (
        connection?.status === 'active' &&
        connection.credentialUseState === 'active' &&
        connection.credentialAuthorizedBy === initiator &&
        actor
      ) {
        await deps.refresh(connection, actor, event.eventId)
        status = 'applied'
      }
      // Repeated reads are safe: publication rechecks connection, binding and
      // erasure authority, using this fact's request identity on every delivery.
      await deps.receipts.insertReceipt(
        event.eventId,
        GOOGLE_CATEGORY_REFRESH_CONSUMER,
        status,
      )
      return { status }
    },
  })
}
