import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { portals } from '#/shared/db/schema'
import { organizationId, portalId, propertyId, userId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestPortal } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { portalUpdated } from '../domain/events'
import { portalToRow } from './mappers/portal.mapper'
import { createAtomicPortalCommandStore } from './portal-command-store'

const ORG = organizationId('org-archive-fence-a')
const OTHER_ORG = organizationId('org-archive-fence-b')
const PROPERTY = propertyId('9a000000-0000-4000-8000-000000000001')
const PORTAL = portalId('9b000000-0000-4000-8000-000000000001')
const ACTOR = userId('archive-fence-manager')
const BEFORE = new Date('2026-11-01T10:00:00Z')
const AFTER = new Date('2026-11-01T10:00:01Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'outbox_events',
    'portal_page_edits',
    'portal_pending_content_changes',
    'portal_localized_overrides',
    'portals',
    'properties',
  ],
})

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Reception', 'reception', 'UTC', $3, $3)`,
    [PROPERTY, ORG, BEFORE],
  )
})

describe('archived Portal content commands', () => {
  it('refuses a current-revision edit without changing content, revision, history or facts', async () => {
    const portal = buildTestPortal({
      id: PORTAL,
      organizationId: ORG,
      propertyId: PROPERTY,
      entityId: PROPERTY,
      publicationState: 'archived',
      linktreeEnabled: true,
      createdAt: BEFORE,
      updatedAt: BEFORE,
    })
    await getDb().insert(portals).values(portalToRow(portal))

    await expect(
      createAtomicPortalCommandStore(
        getDb(),
        createPortalRatingGoalGuard(),
      ).savePortalLinktreeSettings({
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        actorUserId: ACTOR,
        expectedPortalUpdatedAt: BEFORE,
        revision: AFTER,
        occurredAt: AFTER,
        enabled: false,
        titles: [
          {
            locale: 'en',
            title: 'Changed title',
            overrideId: '9c000000-0000-4000-8000-000000000001',
          },
        ],
        event: portalUpdated({
          organizationId: ORG,
          propertyId: PROPERTY,
          portalId: PORTAL,
          previousPublicationState: 'archived',
          publicationState: 'archived',
          sourceAggregateVersion: AFTER.toISOString(),
          occurredAt: AFTER,
        }),
      }),
    ).rejects.toMatchObject({ code: 'portal_inactive' })

    const { rows } = await getPool().query(
      `SELECT publication_state, updated_at, linktree_enabled,
        (SELECT count(*)::int FROM portal_localized_overrides WHERE organization_id = $1) AS overrides,
        (SELECT count(*)::int FROM portal_page_edits WHERE organization_id = $1) AS edits,
        (SELECT count(*)::int FROM portal_pending_content_changes WHERE organization_id = $1) AS pending,
        (SELECT count(*)::int FROM outbox_events WHERE organization_id = $1) AS facts
       FROM portals WHERE organization_id = $1 AND id = $2`,
      [ORG, PORTAL],
    )
    expect(rows).toEqual([
      {
        publication_state: 'archived',
        updated_at: BEFORE,
        linktree_enabled: true,
        overrides: 0,
        edits: 0,
        pending: 0,
        facts: 0,
      },
    ])
  })
})
