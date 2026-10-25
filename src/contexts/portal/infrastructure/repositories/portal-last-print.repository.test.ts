// The remembered last print against real PostgreSQL: one row per Portal that the
// next print replaces, never written for another Organization's Portal, never
// read across Organizations, never written by an older print over a newer one.

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type { PrintFinalLastSettings } from '#/shared/domain/portal-print-final-last'
import type { RecordPortalLastPrintInput } from '../../application/ports/portal-last-print.repository'
import { createPortalLastPrintRepository } from './portal-last-print.repository'

const ORG = organizationId('org-last-print-00000000000001')
const OTHER_ORG = organizationId('org-last-print-00000000000002')
const PROPERTY = propertyId('e6a00000-0000-4000-8000-000000000001')
const OTHER_ORG_PROPERTY = propertyId('e6a00000-0000-4000-8000-000000000002')
const PORTAL = portalId('e6b00000-0000-4000-8000-000000000001')
const SIBLING_PORTAL = portalId('e6b00000-0000-4000-8000-000000000002')
const OTHER_ORG_PORTAL = portalId('e6b00000-0000-4000-8000-000000000003')
const PHOTO = 'e6c00000-0000-4000-8000-000000000001'
const T0 = new Date('2026-10-12T09:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: ['portal_last_prints', 'portals', 'properties'],
})

const settings = (
  patch: Partial<PrintFinalLastSettings> = {},
): PrintFinalLastSettings => ({
  piece: 'tent',
  orientation: 'wide',
  look: 'paper',
  paper: 'letter',
  printer: 'my_printer',
  quantity: 10,
  fillSpares: false,
  perSheet: null,
  cropMarks: false,
  backPage: false,
  languages: ['en', 'es'],
  callToAction: 'rate',
  ...patch,
})

const print = (
  patch: Partial<RecordPortalLastPrintInput> = {},
): RecordPortalLastPrintInput => ({
  organizationId: ORG,
  propertyId: PROPERTY,
  portalId: PORTAL,
  printedAt: T0,
  settings: settings(),
  photo: null,
  ...patch,
})

beforeEach(async () => {
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $3, 'Last Print', 'last-print', 'UTC', $5, $5),
            ($2, $4, 'Other Org Property', 'other-org-last-print', 'UTC', $5, $5)`,
    [PROPERTY, OTHER_ORG_PROPERTY, ORG, OTHER_ORG, T0],
  )
  await getPool().query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, created_at, updated_at)
     VALUES ($1, $4, $6::uuid, 'property', $6::text, 'Reception', 'reception', $8, $8),
            ($2, $4, $6::uuid, 'property', $6::text, 'Spa', 'spa', $8, $8),
            ($3, $5, $7::uuid, 'property', $7::text, 'Other Org Portal', 'other-org-portal', $8, $8)`,
    [
      PORTAL,
      SIBLING_PORTAL,
      OTHER_ORG_PORTAL,
      ORG,
      OTHER_ORG,
      PROPERTY,
      OTHER_ORG_PROPERTY,
      T0,
    ],
  )
})

const repo = () => createPortalLastPrintRepository(getDb())

describe('portalLastPrintRepository (integration)', () => {
  it('has nothing to say about a Portal that was never printed', async () => {
    expect(await repo().find(ORG, PORTAL)).toBeNull()
  })

  it('remembers a print and reads it back unchanged', async () => {
    const stored = print({
      settings: settings({
        piece: 'counter',
        orientation: 'upright',
        look: 'immersive',
        paper: 'a4',
        quantity: 25,
        fillSpares: true,
        perSheet: 2,
        backPage: true,
        languages: ['bg'],
        callToAction: 'tell',
      }),
      photo: { assetId: PHOTO, focalX: 0.25, focalY: 0.6 },
    })

    expect(await repo().record(stored)).toBe(true)

    expect(await repo().find(ORG, PORTAL)).toEqual({
      printedAt: stored.printedAt,
      settings: stored.settings,
      photo: stored.photo,
    })
  })

  it('keeps the two languages in print order', async () => {
    await repo().record(print({ settings: settings({ languages: ['es', 'en'] }) }))

    expect((await repo().find(ORG, PORTAL))?.settings.languages).toEqual(['es', 'en'])
  })

  it('keeps one row per Portal: the next print replaces the last', async () => {
    await repo().record(print({ photo: { assetId: PHOTO, focalX: 0.5, focalY: 0.5 } }))
    const next = print({
      printedAt: new Date(T0.getTime() + 60_000),
      settings: settings({ piece: 'small', quantity: 4 }),
    })

    expect(await repo().record(next)).toBe(true)

    const rows = await getPool().query(
      'SELECT count(*)::int AS n FROM portal_last_prints WHERE portal_id = $1',
      [PORTAL],
    )
    expect(rows.rows[0]?.n).toBe(1)
    expect(await repo().find(ORG, PORTAL)).toEqual({
      printedAt: next.printedAt,
      settings: next.settings,
      photo: null,
    })
  })

  it('does not let a print that finished late replace a later one', async () => {
    const later = print({
      printedAt: new Date(T0.getTime() + 60_000),
      settings: settings({ quantity: 20 }),
    })
    await repo().record(later)

    expect(await repo().record(print({ settings: settings({ quantity: 5 }) }))).toBe(
      false,
    )

    expect((await repo().find(ORG, PORTAL))?.settings.quantity).toBe(20)
  })

  it('remembers each Portal on its own', async () => {
    await repo().record(print({ settings: settings({ quantity: 3 }) }))
    await repo().record(
      print({ portalId: SIBLING_PORTAL, settings: settings({ quantity: 8 }) }),
    )

    expect((await repo().find(ORG, PORTAL))?.settings.quantity).toBe(3)
    expect((await repo().find(ORG, SIBLING_PORTAL))?.settings.quantity).toBe(8)
  })

  it('never reads another Organization a print it did not make', async () => {
    await repo().record(print())

    expect(await repo().find(OTHER_ORG, PORTAL)).toBeNull()
  })

  it('refuses to remember a print against a Portal of another Organization or Property', async () => {
    // Postgres 23503 on the driver error Drizzle wraps: the composite tenant key.
    await expect(
      repo().record(print({ organizationId: OTHER_ORG })),
    ).rejects.toMatchObject({
      cause: { code: '23503', constraint: 'portal_last_prints_portal_tenant_fk' },
    })
    await expect(
      repo().record(print({ portalId: OTHER_ORG_PORTAL, propertyId: PROPERTY })),
    ).rejects.toMatchObject({
      cause: { code: '23503', constraint: 'portal_last_prints_portal_tenant_fk' },
    })

    const rows = await getPool().query(
      'SELECT count(*)::int AS n FROM portal_last_prints',
    )
    expect(rows.rows[0]?.n).toBe(0)
  })

  it('goes with its Portal', async () => {
    await repo().record(print())

    await getPool().query('DELETE FROM portals WHERE id = $1', [PORTAL])

    const rows = await getPool().query(
      'SELECT count(*)::int AS n FROM portal_last_prints',
    )
    expect(rows.rows[0]?.n).toBe(0)
  })

  it('reads a row whose language the catalogue no longer has as no print at all', async () => {
    await repo().record(print())
    await getPool().query(
      `UPDATE portal_last_prints SET languages = '["en", "xx"]'::jsonb WHERE portal_id = $1`,
      [PORTAL],
    )

    expect(await repo().find(ORG, PORTAL)).toBeNull()
  })

  describe('schema constraints', () => {
    const refused = (column: string, value: string) =>
      getPool().query(
        `UPDATE portal_last_prints SET ${column} = ${value} WHERE portal_id = $1`,
        [PORTAL],
      )

    it.each([
      ['piece', "'table'"],
      ['orientation', "'square'"],
      ['look', "'glossy'"],
      ['paper', "'legal'"],
      ['printer', "'courier'"],
      ['call_to_action', "'shout'"],
      ['quantity', '0'],
      ['quantity', '1001'],
      ['per_sheet', '0'],
      ['languages', "'[]'::jsonb"],
      ['languages', `'["en","es","bg"]'::jsonb`],
      ['languages', `'{"en": true}'::jsonb`],
    ])('refuses %s = %s', async (column, value) => {
      await repo().record(print())

      await expect(refused(column, value)).rejects.toThrow(/portal_last_prints_/u)
    })

    it('refuses a photo with its framing missing', async () => {
      await repo().record(print({ photo: { assetId: PHOTO, focalX: 0.5, focalY: 0.5 } }))

      await expect(refused('photo_focal_x', 'NULL')).rejects.toThrow(
        /portal_last_prints_photo_whole/u,
      )
    })
  })
})
