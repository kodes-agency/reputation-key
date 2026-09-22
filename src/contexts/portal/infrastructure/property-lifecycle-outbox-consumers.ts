// Portal's reaction to Property lifecycle facts.
//
// While a Property is archived, a Portal of it that loses its last responsible
// manager records the gap silently (ADR 0052 amendment). Restore requires a
// manager for the Property only, so this consumer announces the Portal gaps
// still open once the Property is back in the workspace.

import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerEvent, ConsumerRegistry, ConsumerResult } from '#/shared/outbox'
import type { PortalResponsibilityRecoveryStore } from './repositories/portal-responsible-manager.repository'

export type PortalPropertyLifecycleConsumerDeps = Readonly<{
  recoveryStore: Pick<PortalResponsibilityRecoveryStore, 'announceGapsAfterRestoreOnce'>
  clock: () => Date
}>

export const PORTAL_ON_PROPERTY_RESTORED_CONSUMER = 'portal.on-property-restored' as const

type PropertyRestoredPayload = Readonly<{
  organizationId: string
  propertyId: string
}>

function parsePropertyRestored(event: ConsumerEvent): PropertyRestoredPayload {
  const payload = validateEventPayload(
    'property.restored',
    event.eventVersion,
    event.payload,
  ) as PropertyRestoredPayload | undefined
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Property restore envelope attribution does not match its payload')
  }
  return payload
}

/** Announce the restored Property's unstaffed live Portals, once per delivery. */
export async function handlePortalPropertyRestored(
  deps: PortalPropertyLifecycleConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = parsePropertyRestored(event)
  const status = await deps.recoveryStore.announceGapsAfterRestoreOnce({
    eventId: event.eventId,
    consumerName: PORTAL_ON_PROPERTY_RESTORED_CONSUMER,
    organizationId: payload.organizationId,
    propertyId: payload.propertyId,
    at: deps.clock(),
  })
  return { status }
}

export function registerPortalPropertyLifecycleConsumers(
  registry: ConsumerRegistry,
  deps: PortalPropertyLifecycleConsumerDeps,
): void {
  const { registerConsumer } = registry
  // Consumer names MUST stay string literals here — the event-job catalogue
  // guard discovers durable consumers by scanning registerConsumer calls.
  registerConsumer({
    eventType: 'property.restored',
    consumerName: 'portal.on-property-restored',
    module: 'portal.property-lifecycle',
    handler: (event) => handlePortalPropertyRestored(deps, event),
  })
}
