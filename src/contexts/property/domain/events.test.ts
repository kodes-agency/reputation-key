import { describe, it, expect } from 'vitest'

import {
  propertyArchived,
  propertyCreated,
  propertyDeleted,
  propertyGoogleBindingChanged,
  propertyRestored,
  propertyUpdated,
} from './events'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'

const PROP_ID = propertyId('prop-1')
const ORG_ID = organizationId('org-1')
const USER_ID = userId('admin-1')
const NOW = new Date('2026-06-01T12:00:00Z')

describe('property events', () => {
  it('propertyCreated generates eventId', () => {
    const event = propertyCreated({
      propertyId: PROP_ID,
      organizationId: ORG_ID,
      name: 'Test Property',
      slug: 'test',
      processingRegion: 'us',
      dataCellId: 'us',
      occurredAt: NOW,
    })
    expect(event.eventId).toBeDefined()
    expect(event._tag).toBe('property.created')
    expect(event.dataCellId).toBe('us')
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

  it('emits identifier-only Google binding changes and validates the epoch', () => {
    const event = propertyGoogleBindingChanged({
      propertyId: PROP_ID,
      organizationId: ORG_ID,
      connectionId: googleConnectionId('connection-1'),
      sourceEpoch: 2,
      change: 'relinked',
      occurredAt: NOW,
    })
    expect(event).toMatchObject({
      _tag: 'property.google_binding.changed',
      sourceEpoch: 2,
      correlationId: null,
    })
    expect(() =>
      propertyGoogleBindingChanged({
        propertyId: PROP_ID,
        organizationId: ORG_ID,
        connectionId: googleConnectionId('connection-1'),
        sourceEpoch: -1,
        change: 'relinked',
        occurredAt: NOW,
      }),
    ).toThrow('sourceEpoch invalid')
  })

  it('constructs bounded archive and explicit restore lifecycle facts', () => {
    const archived = propertyArchived({
      propertyId: PROP_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      previousState: 'active',
      sourceEpoch: 2,
      recoveryDeadline: new Date('2026-07-01T12:00:00Z'),
      occurredAt: NOW,
    })
    const restored = propertyRestored({
      propertyId: PROP_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      previousState: 'archived',
      sourceEpoch: 3,
      googleBindingReadiness: 'reconnect_required',
      occurredAt: new Date('2026-06-02T12:00:00Z'),
    })

    expect(archived).toMatchObject({
      _tag: 'property.archived',
      previousState: 'active',
      sourceEpoch: 2,
    })
    expect(restored).toMatchObject({
      _tag: 'property.restored',
      previousState: 'archived',
      sourceEpoch: 3,
      googleBindingReadiness: 'reconnect_required',
    })
  })

  it('rejects lifecycle facts whose prior state cannot produce that transition', () => {
    expect(() =>
      propertyArchived({
        propertyId: PROP_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        previousState: 'archived' as never,
        sourceEpoch: 2,
        recoveryDeadline: new Date('2026-07-01T12:00:00Z'),
        occurredAt: NOW,
      }),
    ).toThrow('previousState invalid')
    expect(() =>
      propertyRestored({
        propertyId: PROP_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        previousState: 'suspended' as never,
        sourceEpoch: 3,
        googleBindingReadiness: 'ready',
        occurredAt: NOW,
      }),
    ).toThrow('previousState invalid')
  })
})
