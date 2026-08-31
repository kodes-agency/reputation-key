import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { canonicalPortalBetaReadinessReport } from '../../application/portal-beta-readiness-reconciliation'
import { buildPortalBetaReadinessReportFromDatabase } from './portal-beta-readiness-reconciliation.repository'

const ORG = 'org-portal-beta-readiness'
const OTHER_ORG = 'org-portal-beta-readiness-other'
const PROPERTY = 'f4000000-0000-4000-8000-000000000001'
const OTHER_PROPERTY = 'f4000000-0000-4000-8000-000000000002'
const PORTAL = 'f4000000-0000-4000-8000-000000000003'
const OTHER_PORTAL = 'f4000000-0000-4000-8000-000000000004'
const LEGACY_GROUP = 'f4000000-0000-4000-8000-000000000005'
const CURRENT_GROUP = 'f4000000-0000-4000-8000-000000000006'
const LEGACY_MEMBERSHIP = 'f4000000-0000-4000-8000-000000000007'
const CURRENT_MEMBERSHIP = 'f4000000-0000-4000-8000-000000000008'
const CURRENT_MEMBERSHIP_TWO = 'f4000000-0000-4000-8000-000000000018'
const TOKEN = 'f4000000-0000-4000-8000-000000000009'
const TOKEN_TWO = 'f4000000-0000-4000-8000-000000000010'
const OTHER_TOKEN = 'f4000000-0000-4000-8000-000000000011'
const OTHER_ARTIFACT = 'f4000000-0000-4000-8000-000000000012'
const CATEGORY = 'f4000000-0000-4000-8000-000000000013'
const RAW_LINK = 'f4000000-0000-4000-8000-000000000014'
const FUTURE_RAW_LINK = 'f4000000-0000-4000-8000-000000000015'
const OTHER_PROFILE = 'f4000000-0000-4000-8000-000000000016'
const OTHER_CONTENT = 'f4000000-0000-4000-8000-000000000017'
const AS_OF = new Date('2026-08-27T12:00:00.000Z')
const BEFORE = new Date('2026-08-26T12:00:00.000Z')
const AFTER = new Date('2026-08-28T12:00:00.000Z')

let pool: Pool

async function removeFixtures(): Promise<void> {
  for (const table of [
    'portal_links',
    'portal_link_categories',
    'portal_access_artifacts',
    'portal_tokens',
    'portal_group_members',
    'portal_group_memberships',
    'portal_localized_overrides',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'portal_groups',
    'portals',
    'properties',
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [
      [ORG, OTHER_ORG],
    ])
  }
  await deleteTestOrganizations(pool, [ORG, OTHER_ORG])
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await removeFixtures()
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Portal readiness', $1, $3),
            ($2, 'Portal readiness other', $2, $3)`,
    [ORG, OTHER_ORG, BEFORE],
  )
  await pool.query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $3, 'Property A', 'portal-readiness-a', 'UTC', $5, $5),
            ($2, $4, 'Property B', 'portal-readiness-b', 'UTC', $5, $5)`,
    [PROPERTY, OTHER_PROPERTY, ORG, OTHER_ORG, BEFORE],
  )
  await pool.query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug,
        description, hero_image_url, theme, created_by, primary_guest_locale,
        additional_guest_locales, publication_state, created_at, updated_at)
     VALUES ($1, $3, $5, 'team', $6, 'Legacy portal', 'legacy-portal',
             'legacy description', 'https://legacy.invalid/hero.png',
             '{"primaryColor":"#123456"}'::jsonb, NULL, 'en', '["bg","bg"]'::jsonb,
             'disabled', $7, $7),
            ($2, $4, $6::uuid, 'property', $6::text, 'Ready portal', 'ready-portal',
             NULL, NULL, '{}'::jsonb, 'creator-other', 'en', '[]'::jsonb,
             'disabled', $7, $7)`,
    [PORTAL, OTHER_PORTAL, ORG, OTHER_ORG, PROPERTY, OTHER_PROPERTY, BEFORE],
  )
  await pool.query(
    `INSERT INTO portal_groups
       (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $3, $4, 'Legacy group', $5, $5),
            ($2, $3, $4, 'Current group', $5, $5)`,
    [LEGACY_GROUP, CURRENT_GROUP, ORG, PROPERTY, BEFORE],
  )
  await pool.query(
    `INSERT INTO portal_group_members
       (id, portal_group_id, portal_id, organization_id, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [LEGACY_MEMBERSHIP, LEGACY_GROUP, PORTAL, OTHER_ORG, BEFORE],
  )
  await pool.query(
    `INSERT INTO portal_group_memberships
       (id, organization_id, property_id, portal_id, portal_group_id,
        effective_from, created_by)
     VALUES ($1, $3, $4, $5, $6, $7, 'readiness-operator'),
            ($2, $8, $9, $5, $6, $7, 'readiness-operator')`,
    [
      CURRENT_MEMBERSHIP,
      CURRENT_MEMBERSHIP_TWO,
      ORG,
      OTHER_PROPERTY,
      PORTAL,
      CURRENT_GROUP,
      BEFORE,
      OTHER_ORG,
      PROPERTY,
    ],
  )
  await pool.query(
    `INSERT INTO portal_tokens
       (id, organization_id, property_id, portal_id, token_identifier, token_hash,
        version, print_batch, status, issued_at, created_at)
     VALUES ($1, $4, $5, $6, 'legacy-token-one', repeat('1', 64), 1,
             'legacy-print-batch', 'active', $7, $7),
            ($2, $4, $5, $6, 'legacy-token-two', repeat('2', 64), 2,
             NULL, 'active', $7, $7),
            ($3, $8, $9, $10, 'other-token', repeat('3', 64), 1,
             NULL, 'active', $7, $7)`,
    [
      TOKEN,
      TOKEN_TWO,
      OTHER_TOKEN,
      ORG,
      PROPERTY,
      PORTAL,
      BEFORE,
      OTHER_ORG,
      OTHER_PROPERTY,
      OTHER_PORTAL,
    ],
  )
  await pool.query(
    `INSERT INTO portal_access_artifacts
       (id, organization_id, property_id, portal_id, portal_token_id,
        channel, status, published_at)
     VALUES ($1, $2, $3, $4, $5, 'qr', 'published', $6)`,
    [OTHER_ARTIFACT, OTHER_ORG, OTHER_PROPERTY, OTHER_PORTAL, OTHER_TOKEN, BEFORE],
  )
  await pool.query(
    `INSERT INTO portal_link_categories
       (id, portal_id, organization_id, title, sort_key, created_at, updated_at)
     VALUES ($1, $2, $3, 'Legacy links', 'a', $4, $4)`,
    [CATEGORY, PORTAL, ORG, BEFORE],
  )
  await pool.query(
    `INSERT INTO portal_links
       (id, category_id, portal_id, organization_id, property_id, label, url,
        legacy_destination_state, sort_key, created_at, updated_at)
     VALUES ($1, $3, $4, $5, $6, 'Legacy raw', 'https://do-not-print.invalid/path',
             'unclassified', 'a', $7, $7),
            ($2, $3, $4, $5, $6, 'Future raw', 'https://future.invalid/path',
             'unclassified', 'b', $8, $8)`,
    [RAW_LINK, FUTURE_RAW_LINK, CATEGORY, PORTAL, ORG, PROPERTY, BEFORE, AFTER],
  )
  await pool.query(
    `INSERT INTO property_portal_brand_profiles
       (id, organization_id, property_id, display_name, primary_color,
        background_color, text_color, version, updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'Ready property', '#123456', '#ffffff', '#111111',
             1, 'creator-other', $4, $4)`,
    [OTHER_PROFILE, OTHER_ORG, OTHER_PROPERTY, BEFORE],
  )
  await pool.query(
    `INSERT INTO property_portal_brand_contents
       (id, organization_id, property_id, locale, title, short_description,
        version, updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'en', 'Ready title', 'Ready description',
             1, 'creator-other', $4, $4)`,
    [OTHER_CONTENT, OTHER_ORG, OTHER_PROPERTY, BEFORE],
  )
})

afterAll(async () => {
  await removeFixtures()
  await pool.end()
})

describe.sequential('Portal beta-readiness reconciliation repository', () => {
  it('reports deterministic identifier-only gaps and leaves legacy rows untouched', async () => {
    const input = { asOf: AS_OF, organizationIds: [ORG] }
    const first = await buildPortalBetaReadinessReportFromDatabase(getDb(), input)
    const second = await buildPortalBetaReadinessReportFromDatabase(getDb(), input)

    expect(second).toEqual(first)
    expect(first.ready).toBe(false)
    expect(first.scope).toEqual({ kind: 'organizations', organizationIds: [ORG] })
    expect(first.counts.byReason).toMatchObject({
      creator_provenance_unknown: 1,
      legacy_polymorphic_owner_unreconciled: 1,
      legacy_group_scope_invalid: 1,
      legacy_and_effective_group_disagree: 1,
      multiple_active_group_memberships: 1,
      active_group_scope_invalid: 2,
      resolvable_token_missing_access_artifact: 2,
      print_batch_token_requires_replacement: 1,
      multiple_active_portal_tokens: 1,
      property_brand_profile_missing: 1,
      legacy_theme_requires_brand_classification: 1,
      legacy_hero_requires_localized_classification: 1,
      primary_locale_content_incomplete: 1,
      additional_locale_content_incomplete: 1,
      raw_secondary_link_unclassified: 1,
    })
    expect(first.gaps.every((gap) => gap.organizationId === ORG)).toBe(true)
    expect(first.gaps.some((gap) => gap.sourceId === FUTURE_RAW_LINK)).toBe(false)

    const serialized = canonicalPortalBetaReadinessReport(first)
    expect(serialized).not.toContain('Legacy portal')
    expect(serialized).not.toContain('do-not-print.invalid')
    expect(serialized).not.toContain('legacy-token-one')
    expect(serialized).not.toContain('legacy-print-batch')

    const retained = await pool.query(
      `SELECT p.publication_state, l.legacy_destination_state, t.print_batch
       FROM portals p
       JOIN portal_links l ON l.portal_id = p.id AND l.id = $2
       JOIN portal_tokens t ON t.portal_id = p.id AND t.id = $3
       WHERE p.id = $1`,
      [PORTAL, RAW_LINK, TOKEN],
    )
    expect(retained.rows).toEqual([
      {
        publication_state: 'disabled',
        legacy_destination_state: 'unclassified',
        print_batch: 'legacy-print-batch',
      },
    ])
  })

  it('returns no gaps for a complete Portal in another organization', async () => {
    const report = await buildPortalBetaReadinessReportFromDatabase(getDb(), {
      asOf: AS_OF,
      organizationIds: [OTHER_ORG],
    })

    expect(report).toMatchObject({ ready: true, counts: { gapCount: 0 }, gaps: [] })
  })
})
