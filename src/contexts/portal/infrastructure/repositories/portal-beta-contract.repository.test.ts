import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  organizationId,
  portalApprovedDestinationId,
  portalId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { validatePortalDestinationUri } from '../../domain/approved-destination'
import { createPortalApprovedDestinationRepository } from './portal-approved-destination.repository'
import { createPortalExperienceRepository } from './portal-experience.repository'
import { createPortalHealthRepository } from './portal-health.repository'

const ORG_A = organizationId('org-portal-beta-contract-0000000001')
const ORG_B = organizationId('org-portal-beta-contract-0000000002')
const PROPERTY_A = propertyId('fa100000-0000-4000-8000-000000000001')
const PROPERTY_B = propertyId('fa100000-0000-4000-8000-000000000002')
const PORTAL_A = portalId('fa200000-0000-4000-8000-000000000001')
const PORTAL_B = portalId('fa200000-0000-4000-8000-000000000002')
const MANAGER = userId('manager-portal-beta-contract-00000001')
const ADMIN = userId('admin-portal-beta-contract-0000000001')
const NOW = new Date('2026-08-27T08:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'outbox_events',
    'portal_health_intervals',
    'portal_localized_overrides',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'portal_links',
    'portal_link_categories',
    'portal_approved_destinations',
    'portal_page_edits',
    'portals',
    'properties',
  ],
})

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  for (const [orgIdValue, propertyIdValue, portalIdValue, suffix] of [
    [ORG_A, PROPERTY_A, PORTAL_A, 'a'],
    [ORG_B, PROPERTY_B, PORTAL_B, 'b'],
  ] as const) {
    await getPool().query(
      `INSERT INTO properties
         (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'UTC', $5, $5)`,
      [
        propertyIdValue,
        orgIdValue,
        `Portal Beta ${suffix}`,
        `portal-beta-${suffix}`,
        NOW,
      ],
    )
    await getPool().query(
      `INSERT INTO portals
         (id, organization_id, property_id, entity_type, entity_id, name, slug,
          theme, private_feedback_threshold, publication_state, created_at, updated_at)
       VALUES ($1, $2, $3, 'property', $4, $5, $6,
               '{"primaryColor":"#1D4ED8"}'::jsonb, 3, 'draft', $7, $7)`,
      [
        portalIdValue,
        orgIdValue,
        propertyIdValue,
        propertyIdValue,
        `Lobby ${suffix}`,
        `lobby-${suffix}`,
        NOW,
      ],
    )
  }
})

describe.sequential('Portal beta contract repositories (real PostgreSQL)', () => {
  it('governs Property destinations, including later explicit AccountAdmin approval', async () => {
    const repo = createPortalApprovedDestinationRepository(getDb())
    const recognized = await repo.request({
      id: portalApprovedDestinationId('fa300000-0000-4000-8000-000000000001'),
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      destination: validatePortalDestinationUri(
        'https://www.tripadvisor.com/Hotel_Review',
      ),
      requestedBy: MANAGER,
      approveCustom: false,
      at: NOW,
    })
    expect(recognized.approvalState).toBe('approved')

    const customId = portalApprovedDestinationId('fa300000-0000-4000-8000-000000000002')
    const customDestination = validatePortalDestinationUri(
      'https://reviews.example-hotel.test/guest',
    )
    const pending = await repo.request({
      id: customId,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      destination: customDestination,
      requestedBy: MANAGER,
      approveCustom: false,
      at: new Date(NOW.getTime() + 1_000),
    })
    expect(pending.approvalState).toBe('pending')

    const approved = await repo.request({
      id: portalApprovedDestinationId('fa300000-0000-4000-8000-000000000003'),
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      destination: customDestination,
      requestedBy: ADMIN,
      approveCustom: true,
      at: new Date(NOW.getTime() + 2_000),
    })
    expect(approved).toMatchObject({
      id: customId,
      approvalState: 'approved',
      approvedBy: ADMIN,
    })

    const disabled = await repo.disable({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      id: customId,
      reason: 'No longer offered',
      disabledBy: ADMIN,
      at: new Date(NOW.getTime() + 3_000),
    })
    expect(disabled?.approvalState).toBe('disabled')
    const notResurrected = await repo.request({
      id: portalApprovedDestinationId('fa300000-0000-4000-8000-000000000004'),
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      destination: customDestination,
      requestedBy: ADMIN,
      approveCustom: true,
      at: new Date(NOW.getTime() + 4_000),
    })
    expect(notResurrected.approvalState).toBe('disabled')
    await expect(repo.findById(ORG_B, PROPERTY_B, customId)).resolves.toBeNull()
  })

  it('writes a page-edit row for each Portal that links a destination, naming who changed it', async () => {
    const repo = createPortalApprovedDestinationRepository(getDb())
    const destination = validatePortalDestinationUri(
      'https://reviews.example-hotel.test/guest',
    )
    const id = portalApprovedDestinationId('fa300000-0000-4000-8000-000000000009')
    await repo.request({
      id,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      destination,
      requestedBy: MANAGER,
      approveCustom: false,
      at: NOW,
    })
    // A Portal that links the destination, and one in the same Property that does not.
    const categoryId = 'fa400000-0000-4000-8000-000000000001'
    await getPool().query(
      `INSERT INTO portal_link_categories
         (id, portal_id, organization_id, title, sort_key, created_at, updated_at)
       VALUES ($1, $2, $3, 'Links', 'a0', $4, $4)`,
      [categoryId, PORTAL_A, ORG_A, NOW],
    )
    await getPool().query(
      `INSERT INTO portal_links
         (id, category_id, portal_id, organization_id, property_id, label, url,
          destination_id, legacy_destination_state, sort_key, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Reviews', NULL, $6, 'migrated', 'a0', $7, $7)`,
      [
        'fa400000-0000-4000-8000-000000000002',
        categoryId,
        PORTAL_A,
        ORG_A,
        PROPERTY_A,
        id,
        NOW,
      ],
    )

    await repo.approve({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      id,
      approvedBy: ADMIN,
      at: new Date(NOW.getTime() + 1_000),
    })
    await repo.recordNetworkValidation({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      id,
      expectedLastValidatedAt: new Date(NOW.getTime() + 1_000),
      result: {
        outcome: 'unsafe',
        reason: 'dns_non_public',
        observedAt: new Date(NOW.getTime() + 2_000),
      },
    })
    await repo.disable({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      id,
      reason: 'No longer offered',
      disabledBy: MANAGER,
      at: new Date(NOW.getTime() + 3_000),
    })

    const { rows } = await getPool().query(
      `SELECT portal_id::text AS portal_id, change_kind, change_key, actor_user_id
         FROM portal_page_edits WHERE organization_id = $1 ORDER BY occurred_at`,
      [ORG_A],
    )
    const edit = (actor: string | null) => ({
      portal_id: PORTAL_A,
      change_kind: 'approved_destination',
      change_key: id,
      actor_user_id: actor,
    })
    // The request itself reached no Portal (none linked it yet): nothing to record.
    expect(rows).toEqual([edit(ADMIN), edit(null), edit(MANAGER)])
  })

  it('admits public redirects only for scoped, recently validated approvals and removes quarantine immediately', async () => {
    const repo = createPortalApprovedDestinationRepository(getDb())
    const destination = validatePortalDestinationUri(
      'https://www.tripadvisor.com/Hotel_Review',
    )
    const id = portalApprovedDestinationId('fa300000-0000-4000-8000-000000000005')
    await repo.request({
      id,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      destination,
      requestedBy: MANAGER,
      approveCustom: false,
      at: NOW,
    })

    await expect(
      repo.listApprovedUris(
        ORG_A,
        PROPERTY_A,
        [destination.normalizedUri, 'https://not-requested.example/'],
        new Date(NOW.getTime() - 1),
      ),
    ).resolves.toEqual([destination.normalizedUri])
    await expect(
      repo.listApprovedUris(
        ORG_B,
        PROPERTY_B,
        [destination.normalizedUri],
        new Date(NOW.getTime() - 1),
      ),
    ).resolves.toEqual([])
    await expect(
      repo.listApprovedUris(
        ORG_A,
        PROPERTY_A,
        [destination.normalizedUri],
        new Date(NOW.getTime() + 1),
      ),
    ).resolves.toEqual([])

    await repo.recordNetworkValidation({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      id,
      expectedLastValidatedAt: NOW,
      result: {
        outcome: 'unsafe',
        reason: 'dns_non_public',
        observedAt: new Date(NOW.getTime() + 1_000),
      },
    })
    await expect(
      repo.listApprovedUris(
        ORG_A,
        PROPERTY_A,
        [destination.normalizedUri],
        new Date(NOW.getTime() - 1),
      ),
    ).resolves.toEqual([])
  })

  it('versions Property branding and removes an empty Portal-local override', async () => {
    const repo = createPortalExperienceRepository(getDb())
    const firstProfile = await repo.savePropertyProfile({
      id: 'fa400000-0000-4000-8000-000000000001',
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      profile: {
        displayName: 'Example Hotel',
        logoUrl: null,
        defaultHeroImageUrl: null,
        primaryColor: '#1D4ED8',
        backgroundColor: '#FFFFFF',
        textColor: '#111827',
      },
      updatedBy: ADMIN,
      at: NOW,
    })
    const secondProfile = await repo.savePropertyProfile({
      id: 'fa400000-0000-4000-8000-000000000002',
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      profile: {
        displayName: 'Example Hotel Sofia',
        logoUrl: null,
        defaultHeroImageUrl: null,
        primaryColor: '#1D4ED8',
        backgroundColor: '#FFFFFF',
        textColor: '#111827',
      },
      updatedBy: ADMIN,
      at: new Date(NOW.getTime() + 1_000),
    })
    expect(secondProfile).toMatchObject({
      id: firstProfile.id,
      displayName: 'Example Hotel Sofia',
      version: 2,
    })

    await Promise.all(
      (['en', 'bg'] as const).map((locale, index) =>
        repo.savePropertyContent({
          id: `fa500000-0000-4000-8000-00000000000${index + 1}`,
          organizationId: ORG_A,
          propertyId: PROPERTY_A,
          locale,
          content: {
            title: locale === 'en' ? 'Tell us about your stay' : 'Разкажете ни',
            shortDescription:
              locale === 'en' ? 'Your view matters.' : 'Вашето мнение е важно.',
          },
          updatedBy: ADMIN,
          at: new Date(NOW.getTime() + 2_000 + index),
        }),
      ),
    )
    const experience = await repo.getPropertyExperience(ORG_A, PROPERTY_A)
    expect(experience.profile?.version).toBe(2)
    expect(experience.content.map((item) => item.locale)).toEqual(['bg', 'en'])
    await expect(repo.getPropertyExperience(ORG_B, PROPERTY_B)).resolves.toEqual({
      profile: null,
      content: [],
    })

    const override = await repo.savePortalOverride({
      id: 'fa600000-0000-4000-8000-000000000001',
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      locale: 'bg',
      override: {
        title: 'Лоби',
        shortDescription: null,
        heroImageUrl: null,
      },
      updatedBy: MANAGER,
      at: new Date(NOW.getTime() + 3_000),
    })
    expect(override?.version).toBe(1)
    await expect(
      repo.savePortalOverride({
        id: 'fa600000-0000-4000-8000-000000000002',
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        locale: 'bg',
        override: { title: null, shortDescription: null, heroImageUrl: null },
        updatedBy: MANAGER,
        at: new Date(NOW.getTime() + 4_000),
      }),
    ).resolves.toBeNull()
    await expect(repo.listPortalOverrides(ORG_A, PROPERTY_A, PORTAL_A)).resolves.toEqual(
      [],
    )
    // Writing the override and clearing it, a second apart by the same person
    // with no publication between, are one sitting: one entry for two saves.
    // The title was none before and none after, so no wording is kept.
    const { rows: ledger } = await getPool().query(
      `SELECT portal_id::text AS portal_id, change_key, actor_user_id, edit_count,
              previous_text, new_text
         FROM portal_page_edits
        WHERE organization_id = $1 AND change_kind = 'portal_localized_override'
        ORDER BY occurred_at`,
      [ORG_A],
    )
    expect(ledger).toEqual([
      {
        portal_id: PORTAL_A,
        change_key: 'bg',
        actor_user_id: MANAGER,
        edit_count: 2,
        previous_text: null,
        new_text: null,
      },
    ])
    // The Property's welcome text keeps what it said and what it says now.
    const { rows: welcome } = await getPool().query(
      `SELECT change_key, previous_text, new_text
         FROM portal_page_edits
        WHERE organization_id = $1 AND change_kind = 'property_brand_content'
        ORDER BY change_key`,
      [ORG_A],
    )
    expect(welcome).toEqual([
      { change_key: 'bg', previous_text: null, new_text: 'Разкажете ни' },
      { change_key: 'en', previous_text: null, new_text: 'Tell us about your stay' },
    ])
  })

  it('keeps a Portal-local override that still carries a Linktree title when its other fields are cleared', async () => {
    const repo = createPortalExperienceRepository(getDb())
    await getPool().query(
      `INSERT INTO portal_localized_overrides
         (id, organization_id, property_id, portal_id, locale, title,
          linktree_title, version, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'en', 'Lobby', 'Around town', 1, $5, $6, $6)`,
      ['fa600000-0000-4000-8000-000000000011', ORG_A, PROPERTY_A, PORTAL_A, MANAGER, NOW],
    )

    const cleared = await repo.savePortalOverride({
      id: 'fa600000-0000-4000-8000-000000000012',
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      locale: 'en',
      override: { title: null, shortDescription: null, heroImageUrl: null },
      updatedBy: MANAGER,
      at: new Date(NOW.getTime() + 1_000),
    })

    expect(cleared).toMatchObject({
      title: null,
      linktreeTitle: 'Around town',
      version: 2,
    })
    const rows = await repo.listPortalOverrides(ORG_A, PROPERTY_A, PORTAL_A)
    expect(rows.map((row) => [row.locale, row.title, row.linktreeTitle])).toEqual([
      ['en', null, 'Around town'],
    ])
  })

  it('does not touch the Linktree title when other override fields are saved', async () => {
    const repo = createPortalExperienceRepository(getDb())
    await getPool().query(
      `INSERT INTO portal_localized_overrides
         (id, organization_id, property_id, portal_id, locale, title,
          linktree_title, version, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'en', 'Lobby', 'Around town', 1, $5, $6, $6)`,
      ['fa600000-0000-4000-8000-000000000021', ORG_A, PROPERTY_A, PORTAL_A, MANAGER, NOW],
    )

    const saved = await repo.savePortalOverride({
      id: 'fa600000-0000-4000-8000-000000000022',
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      locale: 'en',
      override: { title: 'Front desk', shortDescription: null, heroImageUrl: null },
      updatedBy: MANAGER,
      at: new Date(NOW.getTime() + 1_000),
    })

    expect(saved).toMatchObject({ title: 'Front desk', linktreeTitle: 'Around town' })
  })

  it('keeps one current effective-dated Health interval with bounded history', async () => {
    const repo = createPortalHealthRepository(getDb())
    await repo.transition({
      id: 'fa700000-0000-4000-8000-000000000001',
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      health: { status: 'unavailable', reason: 'publication_draft' },
      sourceVersion: 'draft-1',
      effectiveAt: NOW,
      observedAt: NOW,
    })
    const healthyAt = new Date(NOW.getTime() + 10_000)
    await repo.transition({
      id: 'fa700000-0000-4000-8000-000000000002',
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      health: { status: 'healthy', reason: 'operational' },
      sourceVersion: 'published-2',
      effectiveAt: healthyAt,
      observedAt: healthyAt,
    })
    const repeated = await repo.transition({
      id: 'fa700000-0000-4000-8000-000000000003',
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalId: PORTAL_A,
      health: { status: 'healthy', reason: 'operational' },
      sourceVersion: 'published-replayed',
      effectiveAt: new Date(NOW.getTime() + 5_000),
      observedAt: new Date(NOW.getTime() + 5_000),
    })
    expect(repeated).toMatchObject({
      status: 'healthy',
      reason: 'operational',
      observedAt: healthyAt,
    })
    const history = await repo.listHistory(ORG_A, PROPERTY_A, PORTAL_A, 25)
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({ status: 'healthy', effectiveTo: null })
    expect(history[1]).toMatchObject({
      status: 'unavailable',
      effectiveTo: healthyAt,
    })
    await expect(repo.getCurrent(ORG_B, PROPERTY_B, PORTAL_A)).resolves.toBeNull()
  })
})
