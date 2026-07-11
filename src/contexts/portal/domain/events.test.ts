import { describe, it, expect } from 'vitest'

import { portalCreated, portalGroupCreated } from './events'
import { organizationId, propertyId, portalId, portalGroupId } from '#/shared/domain/ids'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const PORTAL_ID = portalId('port-1')
const GROUP_ID = portalGroupId('group-1')
const NOW = new Date('2026-06-01T12:00:00Z')

describe('portal events', () => {
  it('portalCreated generates eventId', () => {
    const event = portalCreated({
      portalId: PORTAL_ID,
      organizationId: ORG_ID,
      name: 'Test Portal',
      slug: 'test',
      occurredAt: NOW,
    })
    expect(event.eventId).toBeDefined()
    expect(event._tag).toBe('portal.created')
  })

  it('portalGroupCreated works', () => {
    const event = portalGroupCreated({
      portalGroupId: GROUP_ID,
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      name: 'Test Group',
      occurredAt: NOW,
    })
    expect(event._tag).toBe('portal_group.created')
  })
})
