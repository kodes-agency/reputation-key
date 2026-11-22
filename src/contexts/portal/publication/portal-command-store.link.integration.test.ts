// Portal command store against real PostgreSQL: links, link categories and stale workflow facts.

import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { portalLinkCategoryId, portalLinkId } from '#/shared/domain/ids'
import {
  portalLinkCategoryCreated,
  portalLinkCreated,
  portalLinkDeleted,
  portalLinkReordered,
  portalLinkUpdated,
  portalUpdated,
} from '../domain/events'

import { createPortalWorkflowFactStore } from './portal-workflow-fact-store.server'
import {
  CREATED_AT,
  MANAGER,
  ORG_A,
  pageEditRows,
  PORTAL_A,
  PROPERTY_A,
  seedStoredPortal,
  setupPortalCommandStoreTestDb,
  UPDATED_AT,
} from './portal-command-store.test-fixtures'

const { getPool } = setupPortalCommandStoreTestDb()

describe.sequential('Portal command store (real PostgreSQL)', () => {
  it('commits a link with the category it starts, and a link reorder, against one Portal revision chain', async () => {
    const { store } = await seedStoredPortal()
    const linkAt = new Date('2026-08-26T10:06:00.000Z')
    const linkReorderAt = new Date('2026-08-26T10:08:00.000Z')
    const category = {
      id: portalLinkCategoryId('7a000000-0000-4000-8000-000000000001'),
      portalId: PORTAL_A,
      organizationId: ORG_A,
      title: 'Local guides',
      sortKey: 'a0',
      createdAt: linkAt,
      updatedAt: linkAt,
    }
    const categoryCreated = portalLinkCategoryCreated({
      portalId: PORTAL_A,
      categoryId: category.id,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: linkAt.toISOString(),
      occurredAt: linkAt,
    })
    const link = {
      id: portalLinkId('7c000000-0000-4000-8000-000000000001'),
      categoryId: category.id,
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      destinationId: null,
      legacyDestinationState: 'unclassified' as const,
      label: 'City guide',
      url: 'https://example.test/guide',
      iconKey: null,
      imageAssetId: null,
      sortKey: 'a0',
      createdAt: linkAt,
      updatedAt: linkAt,
    }
    const linkCreated = portalLinkCreated({
      portalId: PORTAL_A,
      linkId: link.id,
      categoryId: category.id,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: linkAt.toISOString(),
      occurredAt: linkAt,
    })
    await store.createPortalLink({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      expectedPortalUpdatedAt: CREATED_AT,
      actorUserId: MANAGER,
      link,
      startCategory: { category, event: categoryCreated },
      revision: linkAt,
      occurredAt: linkAt,
      event: linkCreated,
    })
    const linkReordered = portalLinkReordered({
      portalId: PORTAL_A,
      categoryId: category.id,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: linkReorderAt.toISOString(),
      occurredAt: linkReorderAt,
    })
    await store.reorderPortalLinks({
      organizationId: ORG_A,
      actorUserId: MANAGER,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      expectedPortalUpdatedAt: linkAt,
      categoryId: category.id,
      updates: [{ id: link.id, sortKey: 'b0' }],
      revision: linkReorderAt,
      occurredAt: linkReorderAt,
      event: linkReordered,
    })

    const state = await getPool().query(
      `SELECT p.updated_at, c.sort_key AS category_sort_key, l.sort_key AS link_sort_key
       FROM portals p
       JOIN portal_link_categories c ON c.portal_id = p.id
       JOIN portal_links l ON l.portal_id = p.id AND l.category_id = c.id
       WHERE p.organization_id = $1 AND p.id = $2`,
      [ORG_A, PORTAL_A],
    )
    const facts = await getPool().query(
      `SELECT event_type, payload FROM outbox_events
       WHERE organization_id = $1 AND event_type LIKE 'portal_link%'
       ORDER BY created_at, event_type`,
      [ORG_A],
    )
    expect(state.rows).toEqual([
      {
        updated_at: linkReorderAt,
        category_sort_key: 'a0',
        link_sort_key: 'b0',
      },
    ])
    expect(facts.rows).toHaveLength(3)
    for (const fact of facts.rows) {
      expect(fact.payload).toMatchObject({ propertyId: PROPERTY_A })
      expect(fact.payload).toHaveProperty('sourceAggregateVersion')
      expect(fact.payload).not.toHaveProperty('title')
      expect(fact.payload).not.toHaveProperty('label')
      expect(fact.payload).not.toHaveProperty('url')
    }
    // Each command names who made it and what it did to which category or
    // link, in the order they ran; a reorder carries no wording.
    expect(
      (await pageEditRows()).map((row) => [
        row.change_kind,
        row.change_key,
        row.actor_user_id,
        row.previous_text,
        row.new_text,
      ]),
    ).toEqual([
      ['portal_links', `category:${category.id}:created`, MANAGER, null, 'Local guides'],
      ['portal_links', `link:${link.id}:created`, MANAGER, null, 'City guide'],
      ['portal_links', `links:${category.id}:reordered`, MANAGER, null, null],
    ])
  })

  it('commits link update and delete state with identifier-only facts and Portal CAS', async () => {
    const { store } = await seedStoredPortal()
    const linkRevision = UPDATED_AT
    const category = {
      id: portalLinkCategoryId('7a000000-0000-4000-8000-000000000001'),
      portalId: PORTAL_A,
      organizationId: ORG_A,
      title: 'Local guides',
      sortKey: 'a0',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    }
    const link = {
      id: portalLinkId('7c000000-0000-4000-8000-000000000001'),
      categoryId: category.id,
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      destinationId: null,
      legacyDestinationState: 'unclassified' as const,
      label: 'City guide',
      url: 'https://example.test/guide',
      iconKey: null,
      imageAssetId: null,
      sortKey: 'a0',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    }
    await store.createPortalLink({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      expectedPortalUpdatedAt: CREATED_AT,
      actorUserId: MANAGER,
      link,
      startCategory: {
        category,
        event: portalLinkCategoryCreated({
          portalId: PORTAL_A,
          categoryId: category.id,
          organizationId: ORG_A,
          propertyId: PROPERTY_A,
          sourceAggregateVersion: linkRevision.toISOString(),
          occurredAt: CREATED_AT,
        }),
      },
      revision: linkRevision,
      occurredAt: CREATED_AT,
      event: portalLinkCreated({
        portalId: PORTAL_A,
        linkId: link.id,
        categoryId: category.id,
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        sourceAggregateVersion: linkRevision.toISOString(),
        occurredAt: CREATED_AT,
      }),
    })

    const linkUpdateRevision = new Date(linkRevision.getTime() + 1)
    const linkOccurredAt = new Date(CREATED_AT.getTime() + 2)
    await store.updatePortalLink({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      expectedPortalUpdatedAt: linkRevision,
      actorUserId: MANAGER,
      revision: linkUpdateRevision,
      occurredAt: linkOccurredAt,
      linkId: link.id,
      categoryId: category.id,
      patch: {
        label: 'Updated city guide',
        url: 'https://example.test/updated-guide',
        destinationId: null,
        legacyDestinationState: 'quarantined',
        iconKey: 'info',
        imageAssetId: null,
      },
      event: portalLinkUpdated({
        portalId: PORTAL_A,
        linkId: link.id,
        categoryId: category.id,
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        sourceAggregateVersion: linkUpdateRevision.toISOString(),
        occurredAt: linkOccurredAt,
      }),
    })

    const deleteLinkRevision = new Date(linkUpdateRevision.getTime() + 1)
    const wrongCategoryId = portalLinkCategoryId('7a000000-0000-4000-8000-000000000099')
    const failedDelete = portalLinkDeleted({
      portalId: PORTAL_A,
      linkId: link.id,
      categoryId: wrongCategoryId,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: deleteLinkRevision.toISOString(),
      occurredAt: CREATED_AT,
    })
    await expect(
      store.deletePortalLink({
        organizationId: ORG_A,
        actorUserId: MANAGER,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        expectedPortalUpdatedAt: linkUpdateRevision,
        revision: deleteLinkRevision,
        occurredAt: CREATED_AT,
        linkId: link.id,
        categoryId: wrongCategoryId,
        event: failedDelete,
      }),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'revision_conflict' })

    const deletedLink = portalLinkDeleted({
      portalId: PORTAL_A,
      linkId: link.id,
      categoryId: category.id,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: deleteLinkRevision.toISOString(),
      occurredAt: CREATED_AT,
    })
    await store.deletePortalLink({
      organizationId: ORG_A,
      actorUserId: MANAGER,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      expectedPortalUpdatedAt: linkUpdateRevision,
      revision: deleteLinkRevision,
      occurredAt: CREATED_AT,
      linkId: link.id,
      categoryId: category.id,
      event: deletedLink,
    })

    const state = await getPool().query(
      `SELECT p.updated_at,
              (SELECT COUNT(*)::int FROM portal_link_categories c WHERE c.portal_id = p.id) AS categories,
              (SELECT COUNT(*)::int FROM portal_links l WHERE l.portal_id = p.id) AS links
       FROM portals p WHERE p.organization_id = $1 AND p.id = $2`,
      [ORG_A, PORTAL_A],
    )
    expect(state.rows).toEqual([
      { updated_at: deleteLinkRevision, categories: 1, links: 0 },
    ])
    const facts = await getPool().query(
      `SELECT event_type, payload FROM outbox_events
       WHERE organization_id = $1
         AND event_type IN ('portal_link.updated', 'portal_link.deleted')
       ORDER BY event_type`,
      [ORG_A],
    )
    expect(facts.rows).toHaveLength(2)
    for (const fact of facts.rows) {
      expect(fact.payload).toMatchObject({
        portalId: PORTAL_A,
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
      })
      expect(fact.payload).toHaveProperty('sourceAggregateVersion')
      expect(fact.payload).not.toHaveProperty('title')
      expect(fact.payload).not.toHaveProperty('label')
      expect(fact.payload).not.toHaveProperty('url')
      expect(fact.payload).not.toHaveProperty('iconKey')
      expect(fact.payload).not.toHaveProperty('content')
    }
    expect(
      facts.rows.find((fact) => fact.event_type === 'portal_link.updated')?.payload,
    ).toMatchObject({
      sourceAggregateVersion: linkUpdateRevision.toISOString(),
      occurredAt: linkOccurredAt.toISOString(),
    })
    const failedFact = await getPool().query(
      'SELECT id FROM outbox_events WHERE id = $1',
      [failedDelete.eventId],
    )
    expect(failedFact.rows).toHaveLength(0)
    // The refused delete left no ledger row; every command that landed names
    // its category or link and the verb, with the wording that went away or came in.
    expect(
      (await pageEditRows()).map((row) => [
        row.change_key,
        row.actor_user_id,
        row.previous_text,
        row.new_text,
      ]),
    ).toEqual([
      [`category:${category.id}:created`, MANAGER, null, 'Local guides'],
      [`link:${link.id}:created`, MANAGER, null, 'City guide'],
      [`link:${link.id}:deleted`, MANAGER, 'Updated city guide', null],
      [`link:${link.id}:updated`, MANAGER, 'City guide', 'Updated city guide'],
    ])
  })

  it('does not let delayed workflow facts restore a stale Portal command revision', async () => {
    const { store } = await seedStoredPortal({ publicationState: 'published' })

    const categoryAt = new Date('2026-08-26T10:01:00.000Z')
    const staleAt = new Date('2026-08-26T10:02:00.000Z')
    const newerAt = new Date('2026-08-26T10:03:00.000Z')
    const settingsChange = (
      expectedPortalUpdatedAt: Date,
      at: Date,
      enabled: boolean,
    ) => ({
      organizationId: ORG_A,
      actorUserId: MANAGER,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      expectedPortalUpdatedAt,
      enabled,
      revision: at,
      occurredAt: at,
      event: portalUpdated({
        portalId: PORTAL_A,
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        previousPublicationState: 'published',
        publicationState: 'published',
        sourceAggregateVersion: at.toISOString(),
        occurredAt: at,
      }),
    })
    await store.savePortalLinktreeSettings(settingsChange(CREATED_AT, categoryAt, false))
    await store.savePortalLinktreeSettings(settingsChange(categoryAt, newerAt, true))

    const workflowStore = createPortalWorkflowFactStore(getDb())
    const workflowCommand = {
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      portalGroupId: null,
      reviewId: 'delayed-review',
      revision: 1,
      supersedes: null,
      occurredAt: categoryAt,
    } as const
    const recorded = await workflowStore.recordCompletedReview(workflowCommand)
    const workflowRevision = new Date(newerAt.getTime() + 1)
    expect(recorded.status).toBe('recorded')
    expect(recorded.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceAggregateVersion: workflowRevision.toISOString(),
          occurredAt: categoryAt,
        }),
      ]),
    )
    await expect(
      workflowStore.recordCompletedReview(workflowCommand),
    ).resolves.toMatchObject({ status: 'duplicate' })

    await expect(
      store.savePortalLinktreeSettings(settingsChange(categoryAt, staleAt, false)),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'revision_conflict' })

    const state = await getPool().query(
      `SELECT updated_at, linktree_enabled FROM portals
        WHERE organization_id = $1 AND id = $2`,
      [ORG_A, PORTAL_A],
    )
    expect(state.rows).toEqual([
      {
        updated_at: workflowRevision,
        linktree_enabled: true,
      },
    ])
    const workflowFacts = await getPool().query(
      `SELECT event_type, event_version, payload
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'portal.content_review.completed'`,
      [ORG_A],
    )
    expect(
      workflowFacts.rows.map(({ event_type, event_version }) => [
        event_type,
        event_version,
      ]),
    ).toEqual([['portal.content_review.completed', 2]])
    for (const fact of workflowFacts.rows) {
      expect(fact.payload).toMatchObject({
        sourceAggregateVersion: workflowRevision.toISOString(),
        occurredAt: categoryAt.toISOString(),
      })
    }
  })
})
