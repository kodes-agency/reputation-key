import { describe, it, expect } from 'vitest'

import {
  portalCreated,
  portalGroupCreated,
  portalGroupDeleted,
  portalGroupUpdated,
  portalHeroImagePublished,
  portalHealthChanged,
  portalPropertyBrandProfileUpdated,
  portalPropertyBrandContentUpdated,
  portalLocalizedOverrideUpdated,
  portalLocaleSetUpdated,
  portalApprovedDestinationUpdated,
  portalArchived,
  portalLinkCategoryDeleted,
  portalLinkCategoryUpdated,
  portalLinkDeleted,
  portalLinkUpdated,
  portalPublicationPublished,
  portalPublicationRolledBack,
  portalResponsibleManagersUpdated,
  portalResponsibilityNeeded,
  portalRestored,
  portalTokenIssued,
  portalTokenRevoked,
  portalTokenRotated,
  portalUpdated,
} from './events'
import {
  organizationId,
  propertyId,
  portalId,
  portalGroupId,
  portalLinkCategoryId,
  portalLinkId,
  portalApprovedDestinationId,
  userId,
} from '#/shared/domain/ids'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const PORTAL_ID = portalId('port-1')
const GROUP_ID = portalGroupId('group-1')
const CATEGORY_ID = portalLinkCategoryId('category-1')
const LINK_ID = portalLinkId('link-1')
const ACTOR_ID = userId('manager-1')
const NOW = new Date('2026-06-01T12:00:00Z')
const PUBLICATION_DIGEST = 'a'.repeat(64)

describe('portal events', () => {
  it('portalCreated generates eventId', () => {
    const event = portalCreated({
      portalId: PORTAL_ID,
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      publicationState: 'draft',
      sourceAggregateVersion: NOW.toISOString(),
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
      sourceAggregateVersion: NOW.toISOString(),
      occurredAt: NOW,
    })
    expect(event._tag).toBe('portal_group.created')
  })

  it.each([
    [
      'portal-group creation with an empty name',
      () =>
        portalGroupCreated({
          portalGroupId: GROUP_ID,
          organizationId: ORG_ID,
          propertyId: PROP_ID,
          name: ' ',
          sourceAggregateVersion: NOW.toISOString(),
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
          sourceAggregateVersion: NOW.toISOString(),
          occurredAt: NOW,
        }),
      'name must be a non-empty string',
    ],
  ])('rejects %s', (_label, construct, message) => {
    expect(construct).toThrow(message)
  })

  it('keeps business occurrence time separate from a monotonic aggregate revision', () => {
    const revision = '2026-06-01T12:01:00.000Z'

    const event = portalUpdated({
      portalId: PORTAL_ID,
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      previousPublicationState: 'draft',
      publicationState: 'published',
      sourceAggregateVersion: revision,
      occurredAt: NOW,
    })

    expect(event).toMatchObject({
      sourceAggregateVersion: revision,
      occurredAt: NOW,
    })
  })

  it('emits content-minimal publication and rollback facts with immutable snapshot evidence', () => {
    const common = {
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      portalId: PORTAL_ID,
      publicationSnapshotId: 'snapshot-1',
      publicationVersion: 4,
      publicationDigest: PUBLICATION_DIGEST,
      userId: ACTOR_ID,
      sourceAggregateVersion: '2026-06-01T12:01:00.000Z',
      occurredAt: NOW,
      correlationId: 'portal-command-1',
    }

    const unsafePublicationInput = {
      ...common,
      name: 'must not enter the fact',
      destinationUri: 'https://example.com/private-target',
    }
    const published = portalPublicationPublished(unsafePublicationInput)
    const rolledBack = portalPublicationRolledBack(common)

    expect(published).toMatchObject({
      _tag: 'portal.publication.published',
      ...common,
    })
    expect(rolledBack).toMatchObject({
      _tag: 'portal.publication.rolled_back',
      ...common,
    })
    for (const fact of [published, rolledBack]) {
      expect(fact).not.toHaveProperty('name')
      expect(fact).not.toHaveProperty('slug')
      expect(fact).not.toHaveProperty('destinationUri')
    }
  })

  it('emits content-minimal archive and restore facts at the committed revision', () => {
    const common = {
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      portalId: PORTAL_ID,
      userId: ACTOR_ID,
      sourceAggregateVersion: '2026-06-01T12:01:00.000Z',
      occurredAt: NOW,
    }

    const unsafeArchiveInput = { ...common, name: 'must not enter the fact' }
    const archived = portalArchived(unsafeArchiveInput)
    expect(archived).toMatchObject({
      _tag: 'portal.archived',
      correlationId: null,
      ...common,
    })
    expect(archived).not.toHaveProperty('name')
    expect(portalRestored(common)).toMatchObject({
      _tag: 'portal.restored',
      correlationId: null,
      ...common,
    })
  })

  it('rejects publication facts without a positive version or SHA-256 digest', () => {
    const common = {
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      portalId: PORTAL_ID,
      publicationSnapshotId: 'snapshot-1',
      userId: ACTOR_ID,
      sourceAggregateVersion: '2026-06-01T12:01:00.000Z',
      occurredAt: NOW,
    }

    expect(() =>
      portalPublicationPublished({
        ...common,
        publicationVersion: 0,
        publicationDigest: PUBLICATION_DIGEST,
      }),
    ).toThrow('publicationVersion must be a positive integer')
    expect(() =>
      portalPublicationRolledBack({
        ...common,
        publicationVersion: 1,
        publicationDigest: 'not-a-digest',
      }),
    ).toThrow('publicationDigest must be a SHA-256 hex digest')
  })

  it('emits token issuance, rotation, and revocation envelopes', () => {
    const base = {
      portalId: PORTAL_ID,
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceAggregateVersion: NOW.toISOString(),
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

  it('emits identifier-only mutation and completion facts at the committed revision', () => {
    const revision = '2026-06-01T12:01:00.000Z'
    const base = {
      portalId: PORTAL_ID,
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceAggregateVersion: revision,
      occurredAt: NOW,
    }

    expect([
      portalLinkCategoryUpdated({ ...base, categoryId: CATEGORY_ID }),
      portalLinkCategoryDeleted({ ...base, categoryId: CATEGORY_ID }),
      portalLinkUpdated({
        ...base,
        linkId: LINK_ID,
        categoryId: CATEGORY_ID,
      }),
      portalLinkDeleted({
        ...base,
        linkId: LINK_ID,
        categoryId: CATEGORY_ID,
      }),
      portalResponsibleManagersUpdated({ ...base, assignmentCount: 2 }),
      portalHeroImagePublished({
        ...base,
        uploadId: 'upload-1',
      }),
    ]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceAggregateVersion: revision, occurredAt: NOW }),
      ]),
    )
  })

  it('versions group deletion and responsibility recovery facts independently of occurrence time', () => {
    const sourceAggregateVersion = '2026-06-01T12:01:00.000Z'

    expect(
      portalGroupDeleted({
        portalGroupId: GROUP_ID,
        organizationId: ORG_ID,
        propertyId: PROP_ID,
        sourceAggregateVersion,
        occurredAt: NOW,
      }),
    ).toMatchObject({ sourceAggregateVersion, occurredAt: NOW })
    expect(
      portalResponsibilityNeeded({
        portalId: PORTAL_ID,
        organizationId: ORG_ID,
        propertyId: PROP_ID,
        sourceAggregateVersion,
        occurredAt: NOW,
      }),
    ).toMatchObject({ sourceAggregateVersion, occurredAt: NOW })
  })

  it('emits an identifier-only Portal Health transition with both persisted pairs', () => {
    expect(
      portalHealthChanged({
        portalId: PORTAL_ID,
        organizationId: ORG_ID,
        propertyId: PROP_ID,
        previousStatus: 'healthy',
        previousReason: 'operational',
        status: 'degraded',
        reason: 'google_destination_unavailable',
        sourceVersion: 'source-event-1:portal-revision-2',
        occurredAt: NOW,
      }),
    ).toMatchObject({
      _tag: 'portal.health.changed',
      previousStatus: 'healthy',
      previousReason: 'operational',
      status: 'degraded',
      reason: 'google_destination_unavailable',
    })
  })

  it('emits content-minimal brand, locale, override, and destination facts', () => {
    const sourceAggregateVersion = NOW.toISOString()
    expect([
      portalPropertyBrandProfileUpdated({
        organizationId: ORG_ID,
        propertyId: PROP_ID,
        profileVersion: 2,
        sourceAggregateVersion,
        occurredAt: NOW,
      }),
      portalPropertyBrandContentUpdated({
        organizationId: ORG_ID,
        propertyId: PROP_ID,
        guestLocale: 'bg',
        contentVersion: 3,
        sourceAggregateVersion,
        occurredAt: NOW,
      }),
      portalLocalizedOverrideUpdated({
        organizationId: ORG_ID,
        propertyId: PROP_ID,
        portalId: PORTAL_ID,
        guestLocale: 'en',
        overrideVersion: null,
        sourceAggregateVersion,
        occurredAt: NOW,
      }),
      portalLocaleSetUpdated({
        organizationId: ORG_ID,
        propertyId: PROP_ID,
        portalId: PORTAL_ID,
        primaryGuestLocale: 'en',
        additionalGuestLocales: ['bg'],
        sourceAggregateVersion,
        occurredAt: NOW,
      }),
      portalApprovedDestinationUpdated({
        approvedDestinationId: portalApprovedDestinationId(
          '00000000-0000-4000-8000-000000000123',
        ),
        organizationId: ORG_ID,
        propertyId: PROP_ID,
        approvalState: 'approved',
        sourceAggregateVersion,
        occurredAt: NOW,
      }),
    ]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          correlationId: null,
          sourceAggregateVersion,
          occurredAt: NOW,
        }),
      ]),
    )
  })
})
