// The Large card's plan against the round-3 boards (spec-delta S3, "Measured"):
// imm-large-oakmere and paper-large-harborline, to half a point, then the long
// address's 2 in tile, two languages, a wordmark and A6. The words are measured
// with the preview's width tables, which err wide; the PDF's own fonts are
// tested in the print kit's infrastructure.

import QRCode from 'qrcode'
import { describe, expect, it } from 'vitest'
import { printKitFaces, type PrintFace, type PrintKitWords } from './portal-print-kit'
import type { CardBrandInput } from './portal-print-kit-card-brand'
import { largeCardTile, planLargeCard, type LargeCardPlan } from './portal-print-kit-card'
import type { CardLine, CardTextMeasure } from './portal-print-kit-card-words'
import {
  cueLinesFor,
  estimatedCueWidthPt,
  planCodeBlock,
} from './portal-print-kit-code-block'
import { CODE_TILE, TODAY_CODE_TILE, type CodeTile } from './portal-print-kit-code-tile'
import { CODE_BLOCK, FIT, inToPt, mmToPt } from './portal-print-kit-measures'
import { estimatedLineWidthPt } from './portal-print-kit-text-widths'

const measure: CardTextMeasure = (text, style) =>
  estimatedLineWidthPt(
    text,
    style.face === 'display' ? 'display' : 'text',
    style.sizePt,
    style.trackingEm,
  )

const TOKEN = `pt_${'A'.repeat(16)}_${'b'.repeat(43)}`
const BETA = `https://web-closed-beta-v2.up.railway.app/p/${TOKEN}?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10`
const SHORT = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'
const modulesOf = (text: string) =>
  QRCode.create(text, { errorCorrectionLevel: 'M' }).modules.size

/** The boards' logos, measured to their ink: Oakmere's tree-mark and Harborline's badge. */
const OAKMERE = { kind: 'logo', inkAspect: 327 / 321, plate: true } as const
const HARBORLINE = { kind: 'logo', inkAspect: 766 / 426, plate: false } as const
const OAKMERE_NAME = 'Oakmere by Larkspur Hotel Houston Hobby Airport'
const HARBORLINE_NAME = 'Harborline Inn Houston-Near The Galleria'

const faceOf = (
  languages: PrintKitWords['languages'],
  titles: Readonly<Record<string, string>>,
): PrintFace => {
  const [front] = printKitFaces(
    { piece: 'counter_card', languages, callToAction: 'rate' },
    titles,
    'Portal',
  )
  if (front === undefined) throw new Error('no face')
  return front
}

type Options = Readonly<{
  style?: 'immersive' | 'paper'
  paper?: 'letter' | 'a4'
  languages?: PrintKitWords['languages']
  titles?: Readonly<Record<string, string>>
  brand?: CardBrandInput
  name?: string | null
  tile?: CodeTile
}>

function plan(options: Options = {}): LargeCardPlan {
  const face = faceOf(
    options.languages ?? ['en'],
    options.titles ?? { en: 'Reception', es: 'Recepción' },
  )
  const tile = options.tile ?? CODE_TILE.large.letter
  return planLargeCard({
    style: options.style ?? 'immersive',
    paper: options.paper ?? 'letter',
    face,
    brand: options.brand ?? OAKMERE,
    propertyName: options.name === undefined ? OAKMERE_NAME : options.name,
    code: planCodeBlock(
      cueLinesFor(face.blocks.map((block) => block.locale)),
      estimatedCueWidthPt,
      tile,
    ),
    measure,
    wordmarkInkTopPt: (sizePt) => mmToPt(0.3) * (sizePt / 16),
  })
}

const lines = (card: LargeCardPlan, role: CardLine['role']) =>
  card.words.filter(
    (item): item is CardLine => item.kind === 'line' && item.role === role,
  )

/** The bottom of the last word on the face: the message's foot. */
const wordsFoot = (card: LargeCardPlan) =>
  Math.max(
    ...card.words.map(
      (item) => item.topPt + (item.kind === 'line' ? item.heightPt : item.weightPt),
    ),
  )

const brandFoot = (card: LargeCardPlan) => {
  const name = lines(card, 'name').at(-1)
  if (name !== undefined) return name.topPt + name.heightPt
  return card.brand.kind === 'logo'
    ? (card.brand.plate ?? card.brand.ink).y +
        (card.brand.plate ?? card.brand.ink).heightPt
    : card.brand.box.y + card.brand.box.heightPt
}

describe('the Immersive Large card, as imm-large-oakmere', () => {
  const card = plan()

  it('keeps the band at its 1.3 in target and shares the spare height into two 23.2 pt gaps', () => {
    expect(card.bandPt).toBeCloseTo(93.6, 1)
    expect(card.gapPt).toBeGreaterThan(23.2 - 0.5)
    expect(card.gapPt).toBeLessThan(23.2 + 0.5)
    expect(card.stepIndex).toBe(0)
  })

  it('stands the 1.75 in code block from 251 to 403 pt: the bar’s foot on the 29 pt margin', () => {
    expect(card.code.y).toBeCloseTo(251.08, 1)
    expect(card.code.y + card.code.plan.heightPt).toBeCloseTo(432 - 29, 6)
    expect(card.code.x + card.code.plan.tile.tilePt / 2).toBeCloseTo(144, 6)
  })

  it('straddles the band’s edge with the plate, and prints the name in two lines under it', () => {
    if (card.brand.kind !== 'logo' || card.brand.plate === null)
      throw new Error('a plate')
    const { plate } = card.brand
    expect(plate.y + plate.heightPt / 2).toBeCloseTo(card.bandPt ?? 0, 6)
    const name = lines(card, 'name')
    expect(name).toHaveLength(2)
    expect(name[0]?.topPt).toBeCloseTo(plate.y + plate.heightPt + 6, 6)
    expect(name[0]?.style.sizePt).toBe(8.5)
  })

  it('leads with the call to action: the largest line, under the eyebrow', () => {
    const [eyebrow] = lines(card, 'eyebrow')
    const [cta] = lines(card, 'cta')
    expect(eyebrow?.text).toBe('RECEPTION')
    expect(eyebrow?.style.sizePt).toBe(10)
    expect(cta?.style.sizePt).toBe(28)
    expect(
      Math.max(
        ...card.words.flatMap((item) =>
          item.kind === 'line' ? [item.style.sizePt] : [],
        ),
      ),
    ).toBe(28)
  })

  it('puts equal gaps between the brand, the message and the code', () => {
    const [first] = lines(card, 'eyebrow')
    expect((first?.topPt ?? 0) - brandFoot(card)).toBeCloseTo(card.gapPt, 6)
    expect(card.code.y - wordsFoot(card)).toBeCloseTo(card.gapPt, 6)
  })
})

describe('the Paper Large card, as paper-large-harborline', () => {
  const card = plan({
    style: 'paper',
    brand: HARBORLINE,
    name: HARBORLINE_NAME,
    titles: { en: 'Review us on Google' },
  })

  it('sets the logo on the 29 pt top margin and the code’s outline on the bottom one', () => {
    if (card.brand.kind !== 'logo') throw new Error('a logo')
    expect(card.brand.ink.y).toBeCloseTo(29, 6)
    expect(card.brand.plate).toBeNull()
    expect(card.code.y + card.code.plan.heightPt + CODE_BLOCK.outlinePt).toBeCloseTo(
      432 - 29,
      6,
    )
  })

  it('shares the spare height into two 48 pt gaps, with a 30 pt call to action and no band', () => {
    expect(card.bandPt).toBeNull()
    expect(Math.abs(card.gapPt - 48)).toBeLessThan(0.5)
    expect(lines(card, 'cta')[0]?.style.sizePt).toBe(30)
    expect(lines(card, 'eyebrow')[0]?.text).toBe('REVIEW US ON GOOGLE')
  })
})

describe('the Large card with today’s long address', () => {
  it('prints the 2 in tile, never refused, and the gaps simply get smaller', () => {
    const tile = largeCardTile('letter', { text: BETA, symbolModules: modulesOf(BETA) })
    expect(tile).toBe(TODAY_CODE_TILE)
    const card = plan({ tile })
    expect(card.code.plan.tile.tilePt).toBe(inToPt(2))
    expect(card.code.y).toBeCloseTo(432 - 29 - inToPt(2.4), 6)
    // The band gives up a little of its target before the gaps go under 14 pt.
    expect(card.bandPt).toBeLessThanOrEqual(inToPt(1.3))
    expect(card.bandPt).toBeGreaterThanOrEqual(inToPt(1.25))
    expect(card.gapPt).toBeGreaterThanOrEqual(14 - 1e-9)
    expect(card.gapPt).toBeLessThan(plan().gapPt)
    expect(card.stepIndex).toBe(0)
  })

  it('takes 1.75 in once the address is a short print address', () => {
    expect(
      largeCardTile('letter', { text: SHORT, symbolModules: modulesOf(SHORT) }),
    ).toBe(CODE_TILE.large.letter)
    expect(largeCardTile('a4', { text: SHORT, symbolModules: modulesOf(SHORT) })).toBe(
      CODE_TILE.large.a4,
    )
  })
})

describe('a two-language Large card', () => {
  it('keeps the name on the boards’ 1.75 in tile: every type step, the band at its minimum, gaps under 14 pt but not under 2 mm', () => {
    const card = plan({ languages: ['en', 'es'] })
    expect(card.bandPt).toBeCloseTo(inToPt(1.25), 6)
    expect(card.stepIndex).toBe(5)
    expect(card.gapPt).toBeLessThan(14)
    expect(card.gapPt).toBeGreaterThanOrEqual(FIT.gapPt.floor)
    expect(lines(card, 'name')).toHaveLength(2)
    expect(lines(card, 'cta')[0]?.style.sizePt).toBe(24)
    expect(lines(card, 'cta2')[0]?.style.sizePt).toBe(13)
    expect(card.code.y - wordsFoot(card)).toBeCloseTo(card.gapPt, 6)
  })

  it('at today’s 2 in drops only the name line, the last step, and keeps the band, the eyebrow and both calls to action', () => {
    const card = plan({ languages: ['en', 'es'], tile: TODAY_CODE_TILE })
    expect(card.stepIndex).toBe(6)
    expect(lines(card, 'name')).toHaveLength(0)
    expect(card.bandPt).toBeGreaterThanOrEqual(inToPt(1.25) - 1e-9)
    expect(card.gapPt).toBeGreaterThanOrEqual(14)
    expect(lines(card, 'eyebrow')[0]?.text).toBe('RECEPTION · RECEPCIÓN')
    expect(lines(card, 'cta2')[0]?.text).toBe('Valore su visita')
    expect(lines(card, 'sub')).toHaveLength(1)
  })

  it('on Paper has room at 2 in without a step', () => {
    const card = plan({
      languages: ['en', 'es'],
      tile: TODAY_CODE_TILE,
      style: 'paper',
      brand: HARBORLINE,
      name: HARBORLINE_NAME,
    })
    expect(card.stepIndex).toBe(0)
    expect(card.gapPt).toBeGreaterThanOrEqual(14)
    expect(lines(card, 'name')).toHaveLength(2)
  })
})

describe('a Large card with no logo', () => {
  const elegance = { kind: 'wordmark', text: 'Hotel Elegance' } as const

  it('sets the wordmark a group gap under the band, and no name line', () => {
    const card = plan({ brand: elegance, name: 'Hotel Elegance', tile: TODAY_CODE_TILE })
    if (card.brand.kind !== 'wordmark') throw new Error('a wordmark')
    expect(card.brand.box.y).toBeCloseTo((card.bandPt ?? 0) + 14, 6)
    expect(card.brand.lines[0]?.text).toBe('HOTEL ELEGANCE')
    expect(card.brand.lines[0]?.style.sizePt).toBe(16)
    expect(lines(card, 'name')).toHaveLength(0)
  })

  it('fits A6 in English and Bulgarian at 2 in, with its band no smaller than its minimum', () => {
    const card = plan({
      brand: elegance,
      paper: 'a4',
      languages: ['en', 'bg'],
      // An untranslated title reads the primary's, as the print kit's context gives it.
      titles: { en: 'Reception', bg: 'Reception' },
      tile: TODAY_CODE_TILE,
    })
    expect(card.heightPt).toBeCloseTo(mmToPt(148), 6)
    expect(card.bandPt).toBeGreaterThanOrEqual(inToPt(1.25) - 1e-9)
    expect(card.gapPt).toBeGreaterThanOrEqual(FIT.gapPt.floor)
    expect(lines(card, 'eyebrow')[0]?.text).toBe('RECEPTION')
  })
})
