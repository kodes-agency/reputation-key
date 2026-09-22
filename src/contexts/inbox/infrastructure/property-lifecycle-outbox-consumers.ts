// Inbox's reaction to Property lifecycle facts.
//
// Archive fences a Property's provider and public work, and Inbox owns one
// effect of its own that would otherwise keep running: Response Target
// reminder slots. Organization closing already cancels them
// (inbox-organization-lifecycle.adapter.ts); this consumer does the same for
// one archived Property, so "halfway" and "target passed" prompts stop for
// work nobody can do. Items, cycles and targets are untouched, and Restore
// re-arms nothing: a cancelled slot is terminal.

import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { ConsumerEvent, ConsumerRegistry, ConsumerResult } from '#/shared/outbox'
import type { ResponseTargetStore } from '../application/ports/response-target.store'

export type InboxPropertyLifecycleConsumerDeps = Readonly<{
  responseTargetStore: Pick<ResponseTargetStore, 'cancelArchivedPropertyRemindersOnce'>
  clock: () => Date
}>

const ON_PROPERTY_ARCHIVED = 'inbox.on-property-archived'

type PropertyArchivedPayload = Readonly<{
  organizationId: string
  propertyId: string
}>

function parsePropertyArchived(event: ConsumerEvent): PropertyArchivedPayload {
  const payload = validateEventPayload(
    'property.archived',
    event.eventVersion,
    event.payload,
  ) as PropertyArchivedPayload | undefined
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Property archive envelope attribution does not match its payload')
  }
  return payload
}

/** Cancel an archived Property's pending reminder slots, once per delivery. */
export async function handleInboxPropertyArchived(
  deps: InboxPropertyLifecycleConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = parsePropertyArchived(event)
  const status = await deps.responseTargetStore.cancelArchivedPropertyRemindersOnce({
    eventId: event.eventId,
    consumerName: ON_PROPERTY_ARCHIVED,
    organizationId: organizationId(payload.organizationId),
    propertyId: propertyId(payload.propertyId),
    at: deps.clock(),
  })
  return { status }
}

export function registerInboxPropertyLifecycleConsumers(
  registry: ConsumerRegistry,
  deps: InboxPropertyLifecycleConsumerDeps,
): void {
  const { registerConsumer } = registry
  // Consumer names MUST stay string literals here — the event-job catalogue
  // guard discovers durable consumers by scanning registerConsumer calls.
  registerConsumer({
    eventType: 'property.archived',
    consumerName: 'inbox.on-property-archived',
    module: 'inbox.property-lifecycle',
    handler: (event) => handleInboxPropertyArchived(deps, event),
  })
}
