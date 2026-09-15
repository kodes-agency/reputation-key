import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { AUTOMATIC_PUBLIC_DISPLAY_NAME_ACTOR } from '../../domain/portal-experience'
import { createPortalExperienceRepository } from './portal-experience.repository'

const ORGANIZATION_ID = organizationId('org-portal-display-name-0001')
const OTHER_ORGANIZATION_ID = organizationId('org-portal-display-name-0002')
const PROPERTY_ID = propertyId('7c100000-0000-4000-8000-000000000001')
const ADMIN = userId('admin-portal-display-name')
const NOW = new Date('2026-09-15T10:00:00.000Z')
const LATER = new Date('2026-09-15T11:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORGANIZATION_ID,
  orgB: OTHER_ORGANIZATION_ID,
  tables: ['property_portal_brand_profiles', 'outbox_events', 'properties'],
})

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'KODES agency', 'kodes-agency', 'Europe/Sofia', $3, $3)`,
    [PROPERTY_ID, ORGANIZATION_ID, NOW],
  )
})

async function profileRow() {
  const { rows } = await getPool().query(
    `SELECT display_name, primary_color, background_color, text_color, version, updated_by
     FROM property_portal_brand_profiles
     WHERE organization_id = $1 AND property_id = $2`,
    [ORGANIZATION_ID, PROPERTY_ID],
  )
  return rows[0]
}

async function brandEventCount(): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT count(*)::int AS count FROM outbox_events
     WHERE organization_id = $1 AND event_type = 'portal.property_brand_profile.updated'`,
    [ORGANIZATION_ID],
  )
  return rows[0].count
}

describe.sequential('Portal public display name writes (real PostgreSQL)', () => {
  it('fills the automatic name once and never over a saved one', async () => {
    const repository = createPortalExperienceRepository(getDb())
    const ensure = (displayName: string, id: string) =>
      repository.ensurePropertyDisplayName({
        id,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        displayName,
        at: NOW,
      })

    await expect(
      ensure('KODES agency', '7c200000-0000-4000-8000-000000000001'),
    ).resolves.toBe(true)
    await expect(profileRow()).resolves.toEqual({
      display_name: 'KODES agency',
      primary_color: '#2563EB',
      background_color: '#FFFFFF',
      text_color: '#111827',
      version: 1,
      updated_by: AUTOMATIC_PUBLIC_DISPLAY_NAME_ACTOR,
    })
    await expect(brandEventCount()).resolves.toBe(1)

    await expect(
      ensure('Another name', '7c200000-0000-4000-8000-000000000002'),
    ).resolves.toBe(false)
    await expect(profileRow()).resolves.toMatchObject({
      display_name: 'KODES agency',
      version: 1,
    })
    await expect(brandEventCount()).resolves.toBe(1)
  })

  it('records a confirmed name without a new version, and versions a changed one', async () => {
    const repository = createPortalExperienceRepository(getDb())
    await getPool().query(
      `INSERT INTO property_portal_brand_profiles
         (id, organization_id, property_id, display_name, primary_color,
          background_color, text_color, version, updated_by, created_at, updated_at)
       VALUES ('7c300000-0000-4000-8000-000000000001', $1, $2, 'KODES agency',
          '#1D4ED8', '#FFFFFF', '#111827', 1, $3, $4, $4)`,
      [ORGANIZATION_ID, PROPERTY_ID, AUTOMATIC_PUBLIC_DISPLAY_NAME_ACTOR, NOW],
    )
    const save = (displayName: string) =>
      repository.savePropertyDisplayName({
        id: '7c300000-0000-4000-8000-000000000002',
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        displayName,
        updatedBy: ADMIN,
        at: LATER,
      })

    const confirmed = await save('KODES agency')
    expect(confirmed).toMatchObject({ version: 1, updatedBy: ADMIN })
    await expect(brandEventCount()).resolves.toBe(0)

    const renamed = await save('KODES')
    expect(renamed).toMatchObject({ displayName: 'KODES', version: 2, updatedBy: ADMIN })
    // Only the name moves; colours a person chose stay.
    await expect(profileRow()).resolves.toMatchObject({ primary_color: '#1D4ED8' })
    await expect(brandEventCount()).resolves.toBe(1)
  })

  it('starts a Property with no Brand Profile on the default palette', async () => {
    const repository = createPortalExperienceRepository(getDb())

    const saved = await repository.savePropertyDisplayName({
      id: '7c400000-0000-4000-8000-000000000001',
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      displayName: 'KODES',
      updatedBy: ADMIN,
      at: NOW,
    })

    expect(saved).toMatchObject({
      displayName: 'KODES',
      primaryColor: '#2563EB',
      version: 1,
      updatedBy: ADMIN,
    })
    await expect(brandEventCount()).resolves.toBe(1)
  })
})
