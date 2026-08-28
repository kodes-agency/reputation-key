import { z } from 'zod/v4'
import { registerConsumer, type ConsumerEvent } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type { PortalHealthReconciliationStore } from '../application/ports/portal-health-reconciliation.port'

export const PORTAL_HEALTH_RECONCILIATION_CONSUMER =
  'portal.reconcile-health-dependencies' as const

type Deps = Pick<PortalHealthReconciliationStore, 'reconcile'>

const propertyPayloadSchema = z.object({
  organizationId: z.string().min(1),
  propertyId: z.string().min(1),
  occurredAt: z.iso.datetime().optional(),
})

const googlePayloadSchema = propertyPayloadSchema.extend({
  sourceEpoch: z.number().int().nonnegative(),
})

const propertyLifecyclePayloadSchema = propertyPayloadSchema.extend({
  sourceEpoch: z.number().int().positive(),
})

const responsibilityPayloadSchema = propertyPayloadSchema.extend({
  portalId: z.string().min(1),
  sourceAggregateVersion: z.string().min(1),
})

function observedAt(event: ConsumerEvent, payloadOccurredAt?: string): Date {
  const value = payloadOccurredAt ?? event.occurredAt ?? event.recordedAt
  const parsed = value ? new Date(value) : new Date(0)
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() === 0) {
    throw new Error('Portal Health dependency event has no valid occurrence time')
  }
  return parsed
}

function assertAttribution(
  event: ConsumerEvent,
  payload: Readonly<{ organizationId: string; propertyId: string }>,
): void {
  if (
    event.organizationId !== payload.organizationId ||
    event.propertyId !== payload.propertyId
  ) {
    throw new Error('Portal Health dependency envelope attribution mismatch')
  }
}

export async function handlePortalHealthDependencyChanged(
  deps: Deps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'duplicate' }>> {
  const validated = validateEventPayload(
    event.eventType,
    event.eventVersion,
    event.payload,
  )
  if (!validated) throw new Error('Portal Health dependency payload is unavailable')

  let property: z.infer<typeof propertyPayloadSchema>
  let portalId: string | null = null
  let sourceVersion: string
  if (event.eventType === 'property.google_binding.changed') {
    const payload = googlePayloadSchema.parse(validated)
    property = payload
    sourceVersion = `${event.eventId}:google:${payload.sourceEpoch}`
  } else if (
    event.eventType === 'property.archived' ||
    event.eventType === 'property.restored'
  ) {
    const payload = propertyLifecyclePayloadSchema.parse(validated)
    property = payload
    sourceVersion = `${event.eventId}:lifecycle:${payload.sourceEpoch}`
  } else if (
    event.eventType === 'property.updated' ||
    event.eventType === 'property.deleted'
  ) {
    const payload = propertyPayloadSchema.parse(validated)
    property = payload
    sourceVersion = `${event.eventId}:property`
  } else if (event.eventType === 'portal.responsible_managers.updated') {
    const payload = responsibilityPayloadSchema.parse(validated)
    property = payload
    portalId = payload.portalId
    sourceVersion = payload.sourceAggregateVersion
  } else {
    throw new Error(`Unsupported Portal Health dependency event ${event.eventType}`)
  }
  assertAttribution(event, property)
  const result = await deps.reconcile({
    eventId: event.eventId,
    consumerName: PORTAL_HEALTH_RECONCILIATION_CONSUMER,
    organizationId: property.organizationId,
    propertyId: property.propertyId,
    portalId,
    sourceVersion,
    occurredAt: observedAt(event, property.occurredAt),
  })
  return { status: result.status }
}

export function registerPortalHealthConsumers(deps: Deps): void {
  // Keep registrations literal so the governance catalogue can prove exact
  // producer/consumer coverage without executing application composition.
  registerConsumer({
    eventType: 'property.updated',
    consumerName: 'portal.reconcile-health-dependencies',
    module: 'portal.health-outbox-consumers',
    handler: (event) => handlePortalHealthDependencyChanged(deps, event),
  })
  registerConsumer({
    eventType: 'property.deleted',
    consumerName: 'portal.reconcile-health-dependencies',
    module: 'portal.health-outbox-consumers',
    handler: (event) => handlePortalHealthDependencyChanged(deps, event),
  })
  registerConsumer({
    eventType: 'property.archived',
    consumerName: 'portal.reconcile-health-dependencies',
    module: 'portal.health-outbox-consumers',
    handler: (event) => handlePortalHealthDependencyChanged(deps, event),
  })
  registerConsumer({
    eventType: 'property.restored',
    consumerName: 'portal.reconcile-health-dependencies',
    module: 'portal.health-outbox-consumers',
    handler: (event) => handlePortalHealthDependencyChanged(deps, event),
  })
  registerConsumer({
    eventType: 'property.google_binding.changed',
    consumerName: 'portal.reconcile-health-dependencies',
    module: 'portal.health-outbox-consumers',
    handler: (event) => handlePortalHealthDependencyChanged(deps, event),
  })
  registerConsumer({
    eventType: 'portal.responsible_managers.updated',
    consumerName: 'portal.reconcile-health-dependencies',
    module: 'portal.health-outbox-consumers',
    handler: (event) => handlePortalHealthDependencyChanged(deps, event),
  })
}
