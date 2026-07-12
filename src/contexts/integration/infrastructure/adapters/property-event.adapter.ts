// Integration context — property event port adapter
// Implements the PropertyEventPort for the import-property use case.
// Translates port events into EventBus domain events.

import type {
  PropertyEventPort,
  PropertyCreatedEvent,
} from '../../application/ports/property-event.port'
import type { EventBus } from '#/shared/events/event-bus'
import { propertyCreated } from '#/contexts/property/application/public-api'
import {
  propertyId,
  organizationId as toOrgId,
  googleConnectionId as toGoogleConnectionId,
} from '#/shared/domain/ids'

export const createPropertyEventAdapter = (eventBus: EventBus): PropertyEventPort => ({
  emitPropertyCreated: async (event: PropertyCreatedEvent) => {
    await eventBus.emit(
      propertyCreated({
        propertyId: propertyId(event.propertyId),
        organizationId: toOrgId(event.organizationId),
        name: event.name,
        slug: event.slug,
        gbpPlaceId: event.gbpPlaceId,
        gbpLocationName: event.gbpLocationName,
        googleConnectionId: event.googleConnectionId
          ? toGoogleConnectionId(event.googleConnectionId)
          : undefined,
        occurredAt: event.occurredAt,
      }),
    )
  },
})
