// Portal workflow facts against PostgreSQL. A content review records how
// complete the Portal's configuration is, counted on the working copy the
// Immersive Hub publishes (the reader Publish uses): the legacy description,
// Portal theme and link categories no longer count. A link of the round-4
// editor has an approved Property destination and no raw address, and a review
// of a Portal that has one is recorded like any other.

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
type SeedContent = Partial<
  Omit<PortalWorkingCopySeed, 'organizationId' | 'propertyId' | 'portalId'>
>

let seedCount = 0

/**
 * A Portal as the round-4 editor leaves it: English wording, a look, one link
 * with an approved destination and its English label. Each call is a new
 * Property, so one test can seed several.
 */
function immersiveHubPortal(overrides: SeedContent = {}): Seed {
  seedCount += 1
  const n = String(seedCount).padStart(12, '0')
  return {
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
    ...overrides,
  }
}

/** Seeds the Portal live, without the legacy fields a round-4 Portal never has. */
async function seedLivePortal(seed: Seed): Promise<void> {
  await seedPortalWorkingCopy(getPool(), seed)
  await getPool().query(
    `UPDATE portals
        SET publication_state = 'published', description = NULL, theme = '{}'::jsonb
      WHERE organization_id = $1 AND id = $2`,
    [seed.organizationId, seed.portalId],
  )
}

function reviewOf(
  seed: Seed,
  overrides: Partial<PortalWorkflowFactCommand> = {},
): PortalWorkflowFactCommand {
  return {
    organizationId: ORG,
    propertyId: seed.propertyId,
    portalId: seed.portalId,
    portalGroupId: null,
    reviewId: `review-${seed.portalId}`,
    revision: 1,
    supersedes: null,
    occurredAt: REVIEWED_AT,
    googleReviewDestinationVerified: true,
    ...overrides,
  }
}

async function recordReview(
  seed: Seed,
  overrides: Partial<PortalWorkflowFactCommand> = {},
) {
  const result = await createPortalWorkflowFactStore(getDb()).recordCompletedReview(
    reviewOf(seed, overrides),
  )
  const completeness = result.events.find(
    (event) => event._tag === 'portal.configuration_completeness.recorded',
  )
  const ratio = result.events.find(
    (event) => event._tag === 'portal.approved_destination_ratio.recorded',
  )
  return { result, completeness, ratio }
}

describe('Portal workflow fact store — configuration completeness', () => {
  it('counts a complete Immersive Hub Portal five of five without the legacy fields', async () => {
    const seed = immersiveHubPortal()
    await seedLivePortal(seed)

    const { result, completeness } = await recordReview(seed)

    expect(result.status).toBe('recorded')
    expect(completeness).toMatchObject({
      completedFields: 5,
      requiredFields: 5,
      fieldSet: 'immersive_hub',
    })
    const stored = await getPool().query(
      `SELECT event_version, payload FROM outbox_events
        WHERE organization_id = $1
          AND event_type = 'portal.configuration_completeness.recorded'`,
      [ORG],
    )
    expect(stored.rows).toEqual([
      {
        event_version: 3,
        payload: expect.objectContaining({
          portalId: seed.portalId,
          completedFields: 5,
          requiredFields: 5,
          fieldSet: 'immersive_hub',
        }),
      },
    ])
  })

  it.each([
    ['the Property has no Brand Profile', { brand: null }],
    ['the Linktree is switched off', { linktreeEnabled: false }],
    [
      'its only link is still awaiting approval',
      {
        links: [
          {
            id: 'a9500000-0000-4000-8000-000000000001',
            label: '',
            sortKey: 'a0',
            texts: [{ locale: 'en', label: 'Menu' }],
            destination: { state: 'pending', uri: 'https://example.com/menu' },
          },
        ],
      },
    ],
    [
      'the Portal has its own lines but the Property wrote none in the primary language',
      {
        contents: [
          { locale: 'bg', title: 'Хотел Рила', shortDescription: 'Добре дошли' },
        ],
        overrides: [
          {
            locale: 'en',
            title: 'Hotel Rila Lobby',
            shortDescription: 'Welcome to the lobby',
            heroImageUrl: null,
          },
        ],
      },
    ],
    [
      'a link has no label in the primary language',
      {
        links: [
          {
            id: 'a9500000-0000-4000-8000-000000000002',
            label: '',
            sortKey: 'a0',
            texts: [],
            destination: { state: 'approved', uri: 'https://example.com/menu' },
          },
        ],
      },
    ],
  ] as const)('counts four of five when %s', async (_case, overrides) => {
    const seed = immersiveHubPortal(overrides)
    await seedLivePortal(seed)

    const { completeness } = await recordReview(seed)

    expect(completeness).toMatchObject({
      completedFields: 4,
      requiredFields: 5,
      fieldSet: 'immersive_hub',
    })
  })

  it('counts four of five when the Google review destination is not verified', async () => {
    const seed = immersiveHubPortal()
    await seedLivePortal(seed)

    const { completeness } = await recordReview(seed, {
      googleReviewDestinationVerified: false,
    })

    expect(completeness).toMatchObject({ completedFields: 4, requiredFields: 5 })
  })

  it('counts the Brand Profile a Property imported from Google starts with as its look', async () => {
    const seed = immersiveHubPortal()
    await seedLivePortal(seed)
    // As `ensureDefaultPublicDisplayName` leaves it: the default palette, saved by RepKey.
    await getPool().query(
      `UPDATE property_portal_brand_profiles
          SET primary_color = '#2563EB', background_color = '#FFFFFF',
              text_color = '#111827', updated_by = 'system:public-display-name-default'
        WHERE organization_id = $1 AND property_id = $2`,
      [ORG, seed.propertyId],
    )

    const { completeness } = await recordReview(seed)

    expect(completeness).toMatchObject({ completedFields: 5, requiredFields: 5 })
  })
})

describe('Portal workflow fact store — links without a raw address', () => {
  it('records the review and counts only raw links by the legacy address rule', async () => {
    const seed = immersiveHubPortal({
      links: [
        {
          id: 'a9600000-0000-4000-8000-000000000001',
          label: '',
          sortKey: 'a0',
          texts: [{ locale: 'en', label: 'Menu' }],
          destination: { state: 'approved', uri: 'https://example.com/menu' },
        },
        {
          id: 'a9600000-0000-4000-8000-000000000002',
          label: 'Spa',
          sortKey: 'a1',
          destination: { state: 'pending', uri: 'https://example.com/spa' },
        },
        {
          // Raw addresses from before Property destinations. The seed gives
          // them https://legacy.example/menu, which the legacy rule never
          // approved; the second is moved to a Google address, which it did.
          id: 'a9600000-0000-4000-8000-000000000003',
          label: 'Old menu',
          sortKey: 'a2',
          destination: 'legacy',
        },
        {
          id: 'a9600000-0000-4000-8000-000000000004',
          label: 'Old review link',
          sortKey: 'a3',
          destination: 'legacy',
        },
      ],
    })
    await seedLivePortal(seed)
    await getPool().query(
      `UPDATE portal_links SET url = 'https://www.google.com/maps/place/rila'
        WHERE organization_id = $1 AND id = 'a9600000-0000-4000-8000-000000000004'`,
      [ORG],
    )

    const { result, ratio } = await recordReview(seed)

    expect(result.status).toBe('recorded')
    expect(ratio).toMatchObject({ approvedDestinations: 2, configuredDestinations: 4 })
    const portal = await getPool().query(
      `SELECT updated_at FROM portals WHERE organization_id = $1 AND id = $2`,
      [ORG, seed.portalId],
    )
    expect(portal.rows[0]?.updated_at.getTime()).toBeGreaterThanOrEqual(
      REVIEWED_AT.getTime(),
    )
  })

  it('makes a replay of the same review a no-op', async () => {
    const seed = immersiveHubPortal()
    await seedLivePortal(seed)

    await recordReview(seed)
    const { result } = await recordReview(seed)

    expect(result).toEqual({ status: 'duplicate', events: [] })
    const stored = await getPool().query(
      `SELECT count(*)::int AS facts FROM outbox_events WHERE organization_id = $1`,
      [ORG],
    )
    expect(stored.rows).toEqual([{ facts: 3 }])
  })
})
