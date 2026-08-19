import { describe, it, expect } from 'vitest'

import {
  portalCreated,
  portalGroupCreated,
  portalGroupUpdated,
  portalTokenIssued,
  portalTokenRevoked,
  portalTokenRotated,
  portalUpdated,
} from './events'
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

  it.each([
    [
      'portal creation with an empty name',
      () =>
        portalCreated({
          portalId: PORTAL_ID,
          organizationId: ORG_ID,
          name: ' ',
          slug: 'valid',
          occurredAt: NOW,
        }),
      'name must be a non-empty string',
    ],
    [
      'portal creation with an empty slug',
      () =>
        portalCreated({
          portalId: PORTAL_ID,
          organizationId: ORG_ID,
          name: 'Valid',
          slug: ' ',
          occurredAt: NOW,
        }),
      'slug must be a non-empty string',
    ],
    [
      'portal update with an empty name',
      () =>
        portalUpdated({
          portalId: PORTAL_ID,
          organizationId: ORG_ID,
          name: ' ',
          slug: 'valid',
          occurredAt: NOW,
        }),
      'name must be a non-empty string',
    ],
    [
      'portal update with an empty slug',
      () =>
        portalUpdated({
          portalId: PORTAL_ID,
          organizationId: ORG_ID,
          name: 'Valid',
          slug: ' ',
          occurredAt: NOW,
        }),
      'slug must be a non-empty string',
    ],
    [
      'portal-group creation with an empty name',
      () =>
        portalGroupCreated({
          portalGroupId: GROUP_ID,
          organizationId: ORG_ID,
          propertyId: PROP_ID,
          name: ' ',
          occurredAt: NOW,
        }),
      'name must be a non-empty string',
    ],
    [
      'portal-group update with an empty name',
      () =>
        portalGroupUpdated({
          portalGroupId: GROUP_ID,
          organizationId: ORG_ID,
          propertyId: PROP_ID,
          name: ' ',
          occurredAt: NOW,
        }),
      'name must be a non-empty string',
    ],
  ])('rejects %s', (_label, construct, message) => {
    expect(construct).toThrow(message)
  })

  it('emits token issuance, rotation, and revocation envelopes', () => {
    const base = {
      portalId: PORTAL_ID,
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      occurredAt: NOW,
    }
    const issued = portalTokenIssued({
      ...base,
      tokenIdentifier: 'token-1',
      version: 1,
    })
    const rotated = portalTokenRotated({
      ...base,
      previousVersion: 1,
      version: 2,
      gracePeriodEnds: new Date('2026-06-01T12:05:00Z'),
    })
    const revoked = portalTokenRevoked(base)

    expect(issued).toMatchObject({
      _tag: 'portal.token.issued',
      correlationId: null,
      version: 1,
    })
    expect(rotated).toMatchObject({
      _tag: 'portal.token.rotated',
      correlationId: null,
      previousVersion: 1,
      version: 2,
    })
    expect(revoked).toMatchObject({
      _tag: 'portal.token.revoked',
      correlationId: null,
    })
  })
})
