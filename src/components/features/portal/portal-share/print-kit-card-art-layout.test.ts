import { describe, expect, it } from 'vitest'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { printKitFaces } from '#/shared/domain/portal-print-kit'
import type { CardLine } from '#/shared/domain/portal-print-kit-card-words'
import { CODE_TILE, TODAY_CODE_TILE } from '#/shared/domain/portal-print-kit-code-tile'
import { BAND } from '#/shared/domain/portal-print-kit-sizes'
import { previewCardPlan, previewCardTile } from './print-kit-card-art-layout'

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

describe('previewCardTile', () => {
  it('takes 1.75 in for a version 3 symbol, and today’s 2 in for the beta’s version 9', () => {
    expect(previewCardTile('letter', SHORT, 29)).toBe(CODE_TILE.large.letter)
    expect(previewCardTile('a4', LONG, 53)).toBe(TODAY_CODE_TILE)
  })

  it('reads the address’s shape until the symbol is drawn', () => {
    expect(previewCardTile('letter', SHORT, null)).toBe(CODE_TILE.large.letter)
    expect(previewCardTile('letter', LONG, null)).toBe(TODAY_CODE_TILE)
  })
})

describe('previewCardPlan', () => {
  if (FACE === undefined) throw new Error('no face')
  const plan = (logoAspect: number | null, look = LOOK) =>
    previewCardPlan({
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

  it('plans a logo as a wide badge until its picture has loaded', () => {
    const before = plan(null)
    const after = plan(2)
    expect(before.brand).toEqual(after.brand)
  })
})
