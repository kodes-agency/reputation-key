// Portal workflow facts against PostgreSQL. A content review records one fact
// against a live Portal, and a link of the round-4 editor (an approved
// Property destination and no raw address) is reviewed like any other.

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  organizationId,
  portalId,
  propertyId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { PortalWorkflowFactCommand } from '../application/use-cases/complete-content-review'
import { createPortalWorkflowFactStore } from './portal-workflow-fact-store'
import {
  seedPortalWorkingCopy,
  type PortalWorkingCopySeed,
} from './testing/portal-working-copy-seed'

const ORG = organizationId('org-workflowfacts-0000-0000-00000001')
const OTHER_ORG = organizationId('org-workflowfacts-0000-0000-00000002')
const REVIEWED_AT = new Date('2026-10-02T09:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'portal_localized_overrides',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'portal_link_texts',
    'portal_links',
    'portal_media_assets',
    'portal_approved_destinations',
    'portal_link_categories',
    'outbox_events',
    'portals',
    'properties',
  ],
})

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

type Seed = PortalWorkingCopySeed &
  Readonly<{ propertyId: PropertyId; portalId: PortalId }>

let seedCount = 0

/** A Portal as the round-4 editor leaves it, live. Each call is a new Property. */
async function seedLivePortal(): Promise<Seed> {
  seedCount += 1
  const n = String(seedCount).padStart(12, '0')
  const seed: Seed = {
    organizationId: ORG,
    propertyId: propertyId(`a9100000-0000-4000-8000-${n}`),
    portalId: portalId(`a9200000-0000-4000-8000-${n}`),
    categoryId: `a9300000-0000-4000-8000-${n}`,
    slug: `lobby-${n}`,
    primaryGuestLocale: 'en',
    additionalGuestLocales: [],
    brand: { displayName: 'Hotel Rila', defaultHeroImageUrl: null },
    contents: [{ locale: 'en', title: 'Hotel Rila', shortDescription: 'Welcome' }],
    overrides: [],
    links: [
      {
        id: `a9400000-0000-4000-8000-${n}`,
        label: '',
        sortKey: 'a0',
        texts: [{ locale: 'en', label: 'Menu' }],
        destination: { state: 'approved', uri: 'https://example.com/menu' },
      },
    ],
  }
  await seedPortalWorkingCopy(getPool(), seed)
  await getPool().query(
    `UPDATE portals
        SET publication_state = 'published', description = NULL, theme = '{}'::jsonb
      WHERE organization_id = $1 AND id = $2`,
    [seed.organizationId, seed.portalId],
  )
  return seed
}

function reviewOf(seed: Seed): PortalWorkflowFactCommand {
  return {
    organizationId: ORG,
    propertyId: seed.propertyId,
    portalId: seed.portalId,
    portalGroupId: null,
    reviewId: `review-${seed.portalId}`,
    revision: 1,
    supersedes: null,
    occurredAt: REVIEWED_AT,
  }
}

const recordReview = (seed: Seed) =>
  createPortalWorkflowFactStore(getDb()).recordCompletedReview(reviewOf(seed))

const storedFactTypes = async (): Promise<string[]> => {
  const stored = await getPool().query(
    `SELECT event_type FROM outbox_events WHERE organization_id = $1`,
    [ORG],
  )
  return stored.rows.map((row) => row.event_type)
}

describe('Portal workflow fact store', () => {
  it('records the content review fact and moves the Portal revision', async () => {
    const seed = await seedLivePortal()

    const result = await recordReview(seed)

    expect(result.status).toBe('recorded')
    expect(await storedFactTypes()).toEqual(['portal.content_review.completed'])
    const portal = await getPool().query(
      `SELECT updated_at FROM portals WHERE organization_id = $1 AND id = $2`,
      [ORG, seed.portalId],
    )
    expect(portal.rows[0]?.updated_at.getTime()).toBeGreaterThanOrEqual(
      REVIEWED_AT.getTime(),
    )
  })

  it('makes a replay of the same review a no-op', async () => {
    const seed = await seedLivePortal()

    await recordReview(seed)
    const result = await recordReview(seed)

    expect(result).toEqual({ status: 'duplicate', events: [] })
    expect(await storedFactTypes()).toEqual(['portal.content_review.completed'])
  })
})
