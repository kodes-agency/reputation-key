import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { createPortalAiReplyBrandProfileAuthority } from './ai-reply-brand-profile-authority'

const ORGANIZATION_ID = organizationId('org-ai-reply-brand-authority-0001')
const OTHER_ORGANIZATION_ID = organizationId('org-ai-reply-brand-authority-0002')
const PROPERTY_ID = propertyId('7b100000-0000-4000-8000-000000000001')
const NOW = new Date('2026-08-28T10:00:00.000Z')
const DISPLAY_NAME_DIGEST =
  '030c644bf71ad1d7570dc9ab6131f5209ac02fa65e930e2910778e024fc643bf'

const { getPool } = setupIntegrationDb({
  orgA: ORGANIZATION_ID,
  orgB: OTHER_ORGANIZATION_ID,
  tables: ['property_portal_brand_profiles', 'properties'],
})

beforeEach(async () => {
  await getPool().query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'AI Reply Brand Property', 'ai-reply-brand-property', 'UTC', $3, $3)`,
    [PROPERTY_ID, ORGANIZATION_ID, NOW],
  )
  await getPool().query(
    `INSERT INTO property_portal_brand_profiles
       (id, organization_id, property_id, display_name, logo_url,
        default_hero_image_url, primary_color, background_color, text_color,
        version, updated_by, created_at, updated_at)
     VALUES
       ('7b200000-0000-4000-8000-000000000001', $1, $2, 'Example Hotel', NULL,
        NULL, '#1D4ED8', '#FFFFFF', '#111827', 7, 'admin-ai-brand', $3, $3)`,
    [ORGANIZATION_ID, PROPERTY_ID, NOW],
  )
})

describe.sequential('Portal AI Reply Brand Profile authority (real PostgreSQL)', () => {
  it('returns and transactionally revalidates only display name, version, and digest', async () => {
    const authority = createPortalAiReplyBrandProfileAuthority(getDb())

    await expect(
      authority.readCurrentAiReplyBrandProfile(ORGANIZATION_ID, PROPERTY_ID),
    ).resolves.toEqual({
      displayName: 'Example Hotel',
      version: 7,
      displayNameDigest: DISPLAY_NAME_DIGEST,
    })

    await expect(
      getDb().transaction((tx) =>
        authority.isCurrentAiReplyBrandProfile(tx, {
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          version: 7,
          displayNameDigest: DISPLAY_NAME_DIGEST,
        }),
      ),
    ).resolves.toBe(true)

    await expect(
      getDb().transaction((tx) =>
        authority.isCurrentAiReplyBrandProfile(tx, {
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          version: 8,
          displayNameDigest: DISPLAY_NAME_DIGEST,
        }),
      ),
    ).resolves.toBe(false)
  })
})
