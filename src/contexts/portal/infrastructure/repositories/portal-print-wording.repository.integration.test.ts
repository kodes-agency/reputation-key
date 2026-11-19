// The saved print wording against real PostgreSQL: one row per Portal that the
// next save replaces, never written for another Organization's Portal, never read
// across Organizations, never written by an older save over a newer one.

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type { RecordPortalPrintWordingInput } from '../../application/ports/portal-print-wording.repository'
import { createPortalPrintWordingRepository } from './portal-print-wording.repository'

const ORG = organizationId('org-print-wording-0000000001')
const OTHER_ORG = organizationId('org-print-wording-0000000002')
const PROPERTY = propertyId('e7a00000-0000-4000-8000-000000000001')
const OTHER_ORG_PROPERTY = propertyId('e7a00000-0000-4000-8000-000000000002')
const PORTAL = portalId('e7b00000-0000-4000-8000-000000000001')
const SIBLING_PORTAL = portalId('e7b00000-0000-4000-8000-000000000002')
const OTHER_ORG_PORTAL = portalId('e7b00000-0000-4000-8000-000000000003')
const T0 = new Date('2026-10-27T09:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: ['portal_print_wordings', 'portals', 'properties'],
})

const save = (
  patch: Partial<RecordPortalPrintWordingInput> = {},
): RecordPortalPrintWordingInput => ({
  organizationId: ORG,
  propertyId: PROPERTY,
  portalId: PORTAL,
  wording: { callToAction: 'how_was_stay', customWords: null },
  savedAt: T0,
  ...patch,
})

beforeEach(async () => {
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $3, 'Wording', 'wording', 'UTC', $5, $5),
            ($2, $4, 'Other Org Property', 'other-org-wording', 'UTC', $5, $5)`,
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

const repo = () => createPortalPrintWordingRepository(getDb())

describe('portalPrintWordingRepository (integration)', () => {
  it('has nothing to say about a Portal that saved no wording', async () => {
    expect(await repo().find(ORG, PORTAL)).toBeNull()
  })

  it('saves a wording and reads it back unchanged', async () => {
    expect(await repo().save(save())).toBe(true)

    expect(await repo().find(ORG, PORTAL)).toEqual({
      callToAction: 'how_was_stay',
      customWords: null,
    })
  })

  it('saves the manager’s own words per language, and the wording they started from', async () => {
    const customWords = {
      en: { headline: 'Thanks for staying', subline: '' },
      es: { headline: 'Gracias por su estancia', subline: 'Cuéntenos más' },
    }
    await repo().save(save({ wording: { callToAction: 'rate_visit', customWords } }))

    expect(await repo().find(ORG, PORTAL)).toEqual({
      callToAction: 'rate_visit',
      customWords,
    })
  })

  it('keeps one row per Portal: the next save replaces the last', async () => {
    await repo().save(save())
    const next = save({
      savedAt: new Date(T0.getTime() + 60_000),
      wording: { callToAction: 'got_30_seconds', customWords: null },
    })

    expect(await repo().save(next)).toBe(true)

    const rows = await getPool().query(
      'SELECT count(*)::int AS n FROM portal_print_wordings WHERE portal_id = $1',
      [PORTAL],
    )
    expect(rows.rows[0]?.n).toBe(1)
    expect(await repo().find(ORG, PORTAL)).toEqual(next.wording)
  })

  it('does not let a save that finished late replace a later one', async () => {
    await repo().save(
      save({
        savedAt: new Date(T0.getTime() + 60_000),
        wording: { callToAction: 'rate_visit', customWords: null },
      }),
    )

    expect(await repo().save(save())).toBe(false)

    expect((await repo().find(ORG, PORTAL))?.callToAction).toBe('rate_visit')
  })

  it('saves for each Portal on its own', async () => {
    await repo().save(save())
    await repo().save(
      save({
        portalId: SIBLING_PORTAL,
        wording: { callToAction: 'how_was_visit', customWords: null },
      }),
    )

    expect((await repo().find(ORG, PORTAL))?.callToAction).toBe('how_was_stay')
    expect((await repo().find(ORG, SIBLING_PORTAL))?.callToAction).toBe('how_was_visit')
  })

  it('never reads another Organization a wording it did not save', async () => {
    await repo().save(save())

    expect(await repo().find(OTHER_ORG, PORTAL)).toBeNull()
  })

  it('refuses to save a wording against a Portal of another Organization or Property', async () => {
    await expect(repo().save(save({ organizationId: OTHER_ORG }))).rejects.toMatchObject({
      cause: { code: '23503', constraint: 'portal_print_wordings_portal_tenant_fk' },
    })
    await expect(
      repo().save(save({ portalId: OTHER_ORG_PORTAL, propertyId: PROPERTY })),
    ).rejects.toMatchObject({
      cause: { code: '23503', constraint: 'portal_print_wordings_portal_tenant_fk' },
    })

    const rows = await getPool().query(
      'SELECT count(*)::int AS n FROM portal_print_wordings',
    )
    expect(rows.rows[0]?.n).toBe(0)
  })

  it('goes with its Portal', async () => {
    await repo().save(save())

    await getPool().query('DELETE FROM portals WHERE id = $1', [PORTAL])

    const rows = await getPool().query(
      'SELECT count(*)::int AS n FROM portal_print_wordings',
    )
    expect(rows.rows[0]?.n).toBe(0)
  })

  it('reads a row whose language the catalogue no longer has as no saved wording', async () => {
    await repo().save(save())
    await getPool().query(
      `UPDATE portal_print_wordings SET call_to_action_custom = '{"xx": {"headline": "Hi", "subline": ""}}'::jsonb WHERE portal_id = $1`,
      [PORTAL],
    )

    expect(await repo().find(ORG, PORTAL)).toBeNull()
  })

  describe('schema constraints', () => {
    const refused = (column: string, value: string) =>
      getPool().query(
        `UPDATE portal_print_wordings SET ${column} = ${value} WHERE portal_id = $1`,
        [PORTAL],
      )

    it.each([
      ['call_to_action', "'shout'"],
      ['call_to_action', "'rate'"],
      ['call_to_action_custom', `'["How was today?"]'::jsonb`],
    ])('refuses %s = %s', async (column, value) => {
      await repo().save(save())

      await expect(refused(column, value)).rejects.toThrow(/portal_print_wordings_/u)
    })

    it('takes the new wording in the last print too', async () => {
      await expect(
        getPool().query(
          `INSERT INTO portal_last_prints (
             portal_id, organization_id, property_id, piece, orientation, look, paper,
             printer, quantity, fill_spares, crop_marks, back_page, languages,
             call_to_action, printed_at
           ) VALUES ($1, $2, $3, 'tent', 'wide', 'paper', 'letter', 'my_printer', 10,
                     false, false, false, '["en"]'::jsonb, 'how_was_stay', now())`,
          [PORTAL, ORG, PROPERTY],
        ),
      ).resolves.toBeDefined()
    })
  })
})
