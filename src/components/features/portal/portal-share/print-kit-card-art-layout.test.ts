import { describe, expect, it } from 'vitest'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { printKitFaces } from '#/shared/domain/portal-print-kit'
import type { CardLine } from '#/shared/domain/portal-print-kit-card-words'
import { CODE_TILE, TODAY_CODE_TILE } from '#/shared/domain/portal-print-kit-code-tile'
import { BAND, SIZE_TRIM_PT } from '#/shared/domain/portal-print-kit-sizes'
import { previewCardPlan, previewTile } from './print-kit-card-art-layout'

// The Share tab's Large card is planned by the PDF's function, on the tile the
// file prints: the preview cannot show a card the file does not print.

const LONG =
  'https://web-closed-beta-v2.up.railway.app/p/pt_Q7mXc2LpV9sKt4Rw_Hc8vN3pL0qZr5TfY2bWm7XdJ9aKs4EuG1oPi6CnV8hRy3t?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10'
const SHORT = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'

const LOOK: PortalPrintKitView['look'] = {
  wordmark: 'Oakmere',
  propertyName: 'Oakmere by Larkspur Hotel Houston Hobby Airport',
  accentColour: '#D4E3FE',
  fieldColour: '#001E57',
  heroUrl: '/media/hero',
  heroFocal: { x: 0.5, y: 0.5 },
  logoUrl: '/media/logo',
}

const [FACE] = printKitFaces(
  { piece: 'counter_card', languages: ['en'], callToAction: 'rate' },
  { en: 'Reception' },
  'Portal',
)

describe('previewTile', () => {
  it('takes Large’s 1.75 in for a version 3 symbol, and today’s 2 in for the beta’s version 9', () => {
    expect(
      previewTile('counter_card', 'large', 'letter', SHORT, 29)._unsafeUnwrap().tile,
    ).toBe(CODE_TILE.large.letter)
    expect(
      previewTile('counter_card', 'large', 'a4', LONG, 53)._unsafeUnwrap().tile,
    ).toBe(TODAY_CODE_TILE)
  })

  it('reads the address’s shape until the symbol is drawn', () => {
    expect(
      previewTile('counter_card', 'large', 'letter', SHORT, null)._unsafeUnwrap().tile,
    ).toBe(CODE_TILE.large.letter)
    expect(
      previewTile('counter_card', 'large', 'letter', LONG, null)._unsafeUnwrap().tile,
    ).toBe(TODAY_CODE_TILE)
  })

  it('gives Table, Mini and the small tent their own tiles for a short address', () => {
    expect(
      previewTile('counter_card', 'table', 'letter', SHORT, 29)._unsafeUnwrap().tile,
    ).toBe(CODE_TILE.table.letter)
    expect(
      previewTile('counter_card', 'mini', 'a4', SHORT, null)._unsafeUnwrap().tile,
    ).toBe(CODE_TILE.mini.a4)
    expect(
      previewTile('table_tent', 'table', 'letter', SHORT, 29)._unsafeUnwrap().tile,
    ).toBe(CODE_TILE.table.letter)
  })

  it('refuses a size the live address would print too small, with the file’s cause', () => {
    const table = previewTile('counter_card', 'table', 'letter', LONG, 53)
    expect(table._unsafeUnwrapErr()).toMatchObject({
      code: 'print_code_too_small',
      cause: 'needs_short_code',
      size: 'table',
    })
    expect(previewTile('counter_card', 'mini', 'letter', LONG, null).isErr()).toBe(true)
    // A short address on a host too long for the tile blames the host.
    const tooDense = previewTile('counter_card', 'mini', 'letter', SHORT, 33)
    expect(tooDense._unsafeUnwrapErr().cause).toBe('address_host_too_long')
  })

  it('keeps the Letter-half tent on today’s tile, whatever the address', () => {
    expect(
      previewTile('table_tent', 'large', 'letter', LONG, 53)._unsafeUnwrap().tile,
    ).toBe(TODAY_CODE_TILE)
  })
})

describe('previewCardPlan', () => {
  if (FACE === undefined) throw new Error('no face')
  const plan = (logoAspect: number | null, look = LOOK) =>
    previewCardPlan({
      size: 'large',
      style: 'immersive',
      paper: 'letter',
      face: FACE,
      look,
      tile: CODE_TILE.large.letter,
      logoAspect,
    })
  const names = (card: ReturnType<typeof plan>) =>
    card.words.filter(
      (item): item is CardLine => item.kind === 'line' && item.role === 'name',
    )

  it('keeps the band on Immersive and puts the logo on its plate, straddling the band’s edge', () => {
    const card = plan(327 / 321)
    expect(card.bandPt ?? 0).toBeGreaterThanOrEqual(BAND.large.minPt)
    expect(card.brand.kind).toBe('logo')
    if (card.brand.kind !== 'logo' || card.brand.plate === null)
      throw new Error('no plate')
    const plate = card.brand.plate
    expect(plate.y + plate.heightPt / 2).toBeCloseTo(card.bandPt ?? 0, 6)
  })

  it('prints the name under a logo, and a wordmark with no name line under it', () => {
    expect(names(plan(1)).length).toBeGreaterThan(0)
    const wordmark = plan(null, { ...LOOK, logoUrl: null })
    expect(wordmark.brand.kind).toBe('wordmark')
    expect(names(wordmark)).toEqual([])
  })

  it('plans no name line when the manager turns the name off', () => {
    const off = previewCardPlan({
      size: 'large',
      style: 'immersive',
      paper: 'letter',
      face: FACE,
      look: LOOK,
      tile: CODE_TILE.large.letter,
      logoAspect: 1,
      showPropertyName: false,
    })
    expect(names(off)).toEqual([])
    expect(off.words.length).toBeGreaterThan(0)
  })

  it.each(['table', 'mini'] as const)(
    'plans a %s card on its own measures, with the band the size keeps',
    (size) => {
      const card = previewCardPlan({
        size,
        style: 'immersive',
        paper: 'letter',
        face: FACE,
        look: LOOK,
        tile: CODE_TILE[size].letter,
        logoAspect: 1,
      })
      expect(card.size).toBe(size)
      expect(card.widthPt).toBe(SIZE_TRIM_PT[size].letter.widthPt)
      expect(card.bandPt ?? 0).toBeGreaterThanOrEqual(BAND[size].minPt)
      // A Mini card drops the name and the eyebrow; a Table card keeps both.
      expect(names(card).length > 0).toBe(size === 'table')
      expect(card.code.plan.tile).toBe(CODE_TILE[size].letter)
    },
  )

  it('plans a logo as a wide badge until its picture has loaded', () => {
    const before = plan(null)
    const after = plan(2)
    expect(before.brand).toEqual(after.brand)
  })
})
