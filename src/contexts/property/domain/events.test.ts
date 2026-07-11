import { describe, it, expect } from 'vitest'

import { propertyCreated, propertyUpdated, propertyDeleted } from './events'
import { propertyId, organizationId } from '#/shared/domain/ids'

const PROP_ID = propertyId('prop-1')
const ORG_ID = organizationId('org-1')
const NOW = new Date('2026-06-01T12:00:00Z')

describe('property events', () => {
  it('propertyCreated generates eventId', () => {
    const event = propertyCreated({
      propertyId: PROP_ID,
      organizationId: ORG_ID,
      name: 'Test Property',
      slug: 'test',
      occurredAt: NOW,
    })
    expect(event.eventId).toBeDefined()
    expect(event._tag).toBe('property.created')
  })

  it('propertyUpdated works', () => {
    const event = propertyUpdated({
      propertyId: PROP_ID,
      organizationId: ORG_ID,
      name: 'Updated',
      slug: 'updated',
      occurredAt: NOW,
    })
    expect(event._tag).toBe('property.updated')
  })

  it('propertyDeleted works', () => {
    const event = propertyDeleted({
      propertyId: PROP_ID,
      organizationId: ORG_ID,
      occurredAt: NOW,
    })
    expect(event._tag).toBe('property.deleted')
  })
})
