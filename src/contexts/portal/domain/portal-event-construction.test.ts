import { beforeEach, describe, expect, it } from 'vitest'
import * as events from './events'
import type { PortalEventArgs } from './portal-event-base'
import {
  organizationId,
  portalAccessArtifactId,
  portalApprovedDestinationId,
  portalGroupId,
  portalId,
  portalLinkCategoryId,
  portalLinkId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'

const occurredAt = new Date('2026-06-01T12:00:00.000Z')
const scope = {
  organizationId: organizationId('org-1'),
  propertyId: propertyId('10000000-0000-4000-8000-000000000001'),
  sourceAggregateVersion: '2026-06-01T12:01:00.000Z',
  occurredAt,
}
const portal = {
  ...scope,
  portalId: portalId('10000000-0000-4000-8000-000000000002'),
}
const group = {
  ...scope,
  portalGroupId: portalGroupId('10000000-0000-4000-8000-000000000003'),
}
const category = {
  ...portal,
  categoryId: portalLinkCategoryId('10000000-0000-4000-8000-000000000004'),
}
const link = {
  ...category,
  linkId: portalLinkId('10000000-0000-4000-8000-000000000005'),
}
const archive = { ...portal, userId: userId('manager-1') }
const publication = {
  ...archive,
  publicationSnapshotId: '10000000-0000-4000-8000-000000000006',
  publicationVersion: 4,
  publicationDigest: 'a'.repeat(64),
}
const workflow = {
  ...portal,
  reviewId: 'review-1',
  revision: 2,
  portalGroupId: group.portalGroupId,
  supersedesSourceEventId: '10000000-0000-4000-8000-000000000007',
}
const health = {
  organizationId: portal.organizationId,
  propertyId: portal.propertyId,
  portalId: portal.portalId,
  previousStatus: 'healthy',
  previousReason: 'operational',
  status: 'degraded',
  reason: 'google_destination_unavailable',
  sourceVersion: 'health-fence-2',
  occurredAt,
} as const

function example<T extends events.PortalEvent>(
  tag: T['_tag'],
  construct: (args: PortalEventArgs<T>) => T,
  args: PortalEventArgs<T>,
) {
  return {
    tag,
    args,
    create: (overrides: Partial<PortalEventArgs<T>> = {}) =>
      construct({ ...args, ...overrides }),
  }
}

const examples = [
  example('portal.created', events.portalCreated, {
    ...portal,
    publicationState: 'draft',
  }),
  example('portal.updated', events.portalUpdated, {
    ...portal,
    previousPublicationState: 'draft',
    publicationState: 'published',
  }),
  example('portal.publication.published', events.portalPublicationPublished, publication),
  example(
    'portal.publication.rolled_back',
    events.portalPublicationRolledBack,
    publication,
  ),
  example('portal.archived', events.portalArchived, archive),
  example('portal.restored', events.portalRestored, archive),
  example('portal.deleted', events.portalDeleted, portal),
  example('portal.responsibility_became_needed', events.portalResponsibilityNeeded, {
    ...portal,
    actorUserId: archive.userId,
  }),
  example(
    'portal.responsible_managers.updated',
    events.portalResponsibleManagersUpdated,
    {
      ...portal,
      assignmentCount: 2,
    },
  ),
  example('portal.health.changed', events.portalHealthChanged, health),
  example(
    'portal.property_brand_profile.updated',
    events.portalPropertyBrandProfileUpdated,
    {
      ...scope,
      profileVersion: 2,
    },
  ),
  example(
    'portal.property_brand_content.updated',
    events.portalPropertyBrandContentUpdated,
    {
      ...scope,
      guestLocale: 'bg',
      contentVersion: 3,
    },
  ),
  example('portal.localized_override.updated', events.portalLocalizedOverrideUpdated, {
    ...portal,
    guestLocale: 'en',
    overrideVersion: null,
  }),
  example('portal.locale_set.updated', events.portalLocaleSetUpdated, {
    ...portal,
    primaryGuestLocale: 'en',
    additionalGuestLocales: ['bg', 'de'],
  }),
  example(
    'portal.approved_destination.updated',
    events.portalApprovedDestinationUpdated,
    {
      ...scope,
      approvedDestinationId: portalApprovedDestinationId(
        '10000000-0000-4000-8000-000000000008',
      ),
      approvalState: 'approved',
    },
  ),
  example('portal.token.issued', events.portalTokenIssued, {
    ...portal,
    tokenIdentifier: 'token-1',
    version: 1,
  }),
  example('portal.token.rotated', events.portalTokenRotated, {
    ...portal,
    previousVersion: 1,
    version: 2,
    gracePeriodEnds: new Date('2026-06-01T12:05:00.000Z'),
  }),
  example('portal.token.revoked', events.portalTokenRevoked, portal),
  example('portal.access_artifact.published', events.portalAccessArtifactPublished, {
    ...portal,
    accessArtifactId: portalAccessArtifactId('10000000-0000-4000-8000-000000000009'),
    channel: 'nfc',
  }),
  example(
    'portal.content_review.completed',
    events.portalContentReviewCompleted,
    workflow,
  ),
  example('portal_link_category.created', events.portalLinkCategoryCreated, category),
  example('portal_link_category.reordered', events.portalLinkCategoryReordered, portal),
  example('portal_link_category.updated', events.portalLinkCategoryUpdated, category),
  example('portal_link_category.deleted', events.portalLinkCategoryDeleted, category),
  example('portal_link.created', events.portalLinkCreated, link),
  example('portal_link.reordered', events.portalLinkReordered, category),
  example('portal_link.updated', events.portalLinkUpdated, link),
  example('portal_link.deleted', events.portalLinkDeleted, link),
  example('portal_group.created', events.portalGroupCreated, {
    ...group,
    name: 'Reception',
  }),
  example('portal_group.updated', events.portalGroupUpdated, {
    ...group,
    name: 'Reception',
  }),
  example('portal_group.deleted', events.portalGroupDeleted, group),
  example('portal_group.portal_added', events.portalAddedToGroup, {
    ...group,
    portalId: portal.portalId,
  }),
  example('portal_group.portal_removed', events.portalRemovedFromGroup, {
    ...group,
    portalId: portal.portalId,
  }),
]

describe('Portal event construction contracts', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  it.each(examples)(
    '$tag preserves its exact payload and supplies a fresh event ID',
    ({ tag, args, create }) => {
      const first = create()
      const second = create()
      expect(first).toEqual({
        _tag: tag,
        eventId: expect.any(String),
        ...args,
        correlationId: null,
      })
      expect(first.eventId).toMatch(/^[0-9a-f-]{36}$/u)
      expect(second.eventId).not.toBe(first.eventId)
      expect(first.occurredAt).toBe(occurredAt)
    },
  )

  it.each(examples)(
    '$tag preserves supplied correlation identifiers and normalizes nullish ones',
    ({ create }) => {
      for (const correlationId of [undefined, null, '', 'command-1']) {
        expect(create({ correlationId }).correlationId).toBe(correlationId ?? null)
      }
    },
  )

  it.each(examples)(
    '$tag survives schema validation and outbox serialization',
    ({ tag, create }) => {
      const fact = create({ correlationId: 'command-1' })
      const stored = toOutboxEvent(fact)
      expect(stored).toMatchObject({
        eventType: tag,
        organizationId: scope.organizationId,
        propertyId: scope.propertyId,
        payload: { occurredAt: occurredAt.toISOString(), correlationId: 'command-1' },
      })
    },
  )

  it.each(examples)('$tag refuses an occurrence that is not a Date', ({ create }) => {
    expect(() => create({ occurredAt: '2026-06-01' as unknown as Date })).toThrow(
      'occurredAt must be Date',
    )
  })

  it.each([events.portalPublicationPublished, events.portalPublicationRolledBack])(
    'publication facts omit unexpected content even when it is present at runtime',
    (construct) => {
      const input = {
        ...publication,
        name: 'private name',
        destinationUri: 'https://example.com/private',
      }
      expect(construct(input)).toEqual({
        ...publication,
        _tag: expect.any(String),
        eventId: expect.any(String),
        correlationId: null,
      })
    },
  )

  it.each([events.portalArchived, events.portalRestored])(
    'archive facts omit unexpected content even when it is present at runtime',
    (construct) => {
      const input = { ...archive, name: 'private name', theme: { color: 'red' } }
      expect(construct(input)).toEqual({
        ...archive,
        _tag: expect.any(String),
        eventId: expect.any(String),
        correlationId: null,
      })
    },
  )

  it('requires canonical aggregate revisions while health keeps its separate fence', () => {
    expect(() =>
      events.portalCreated({
        ...portal,
        publicationState: 'draft',
        sourceAggregateVersion: '2026-06-01',
      }),
    ).toThrow('sourceAggregateVersion must be an ISO timestamp')
    expect(() =>
      events.portalLinkCreated({ ...link, sourceAggregateVersion: 'invalid' }),
    ).toThrow('sourceAggregateVersion must be an ISO timestamp')
    expect(() =>
      events.portalGroupDeleted({ ...group, sourceAggregateVersion: 'invalid' }),
    ).toThrow('sourceAggregateVersion must be an ISO timestamp')
    expect(() => events.portalHealthChanged({ ...health, sourceVersion: '' })).toThrow(
      'sourceVersion must be a non-empty health fence',
    )
    expect(() =>
      events.portalHealthChanged({ ...health, status: 'healthy', reason: 'operational' }),
    ).toThrow('Portal Health change must change the persisted status or reason')
  })
})
