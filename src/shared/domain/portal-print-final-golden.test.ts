// The planners against the final design boards (final-design-2026-10-25, the
// call-to-action set: no stars, "How did we do?", the short scan cue): every card
// of the stand-in set's family, Europe, long-address, ladder and hard-case
// boards, fed its parts' ink boxes as the boards measured them, must land where
// the boards put it, within 0.25 mm: each part, the code block, the ink margins
// and the group gaps. The fixture holds the boards' own measurements (mm from
// the trim's top-left corner); its tiles are drawn with the browser's 0.26 mm
// outline where the PDF draws 0.35 mm, which the tolerance covers.

import { describe, expect, it } from 'vitest'
import golden from './__fixtures__/portal-print-final-golden.json'
import type { GuestLocale } from './guest-locale'
import type { PrintFinalFace, PrintFinalPiece } from './portal-print-final'
import { choosePrintFinalTile, printFinalCodeBlock } from './portal-print-final-code'
import { PRINT_FINAL_SCAN_CUE, printFinalCueLines } from './portal-print-final-cue'
import { PRINT_FINAL_MEASURES, mmPt, ptMm } from './portal-print-final-measures'
import type { PrintFinalPart, PrintFinalPartKey } from './portal-print-final-parts'
import { planPrintFinalFace, type PrintFinalPlan } from './portal-print-final-plan'
import { printFinalPhotoBox, printFinalPhotoDpi } from './portal-print-final-photo'
import type { PrintFinalTextMeasurer } from './portal-print-final-text'
import { estimatedLineWidthPt } from './portal-print-kit-text-widths'

type GoldenCard = (typeof golden.cards)[number]

const TOLERANCE_MM = 0.25
/** Version 3 (the short address) and version 9 (today's long address), quiet zone not included. */
const SYMBOL_MODULES = { short: 29, long: 53 } as const

/** The width tables the preview measures a cue by: they err wide, and every board's cue still keeps one line. */
const measurer: PrintFinalTextMeasurer = {
  advancePt: (text, style) => estimatedLineWidthPt(text, 'text', style.sizePt),
  ink: () => ({ leftPt: 0, rightPt: 0, ascentPt: 0, descentPt: 0 }),
}

const cueLinesOf = (card: GoldenCard, tilePt: number) =>
  printFinalCueLines(
    card.cues,
    tilePt,
    PRINT_FINAL_MEASURES[card.region as 'us' | 'eu'][card.piece as PrintFinalPiece].cuePt,
    measurer,
  )

const faceOf = (card: GoldenCard): PrintFinalFace => ({
  piece: card.piece as PrintFinalPiece,
  orientation: card.orientation as PrintFinalFace['orientation'],
  look: card.look as PrintFinalFace['look'],
  region: card.region as PrintFinalFace['region'],
})

const nameOf = (card: GoldenCard): string =>
  `${card.board}: ${card.look} ${card.piece} ${card.orientation} (${card.region}${card.address === 'long' ? ', long address' : ''})`

function tileOf(card: GoldenCard) {
  const face = faceOf(card)
  const base = PRINT_FINAL_MEASURES[face.region][face.piece].tilePt
  const stepUp = card.board === 'tile-ladder' && Math.abs(card.tileIn * 72 - base) > 1
  const tile = choosePrintFinalTile({
    ...face,
    address: card.address as 'short' | 'long',
    symbolModules: SYMBOL_MODULES[card.address as 'short' | 'long'],
    rung: stepUp ? 'step_up' : 'base',
  })
  return tile._unsafeUnwrap()
}

function planOf(card: GoldenCard): PrintFinalPlan {
  const face = faceOf(card)
  const tile = tileOf(card)
  const cues = cueLinesOf(card, tile.tilePt)
  const parts: PrintFinalPart[] = card.parts.map((part) => ({
    key: part.key as PrintFinalPartKey,
    widthPt: mmPt(part.w),
    heightPt: mmPt(part.h),
  }))
  return planPrintFinalFace({
    face,
    parts,
    code: printFinalCodeBlock(face, tile, cues.length),
  })
}

function inkMarginsMm(plan: PrintFinalPlan) {
  const boxes = [
    ...plan.parts.map((p) => ({
      l: p.xPt,
      t: p.yPt,
      r: p.xPt + p.widthPt,
      b: p.yPt + p.heightPt,
    })),
    {
      l: plan.code.leftPt,
      t: plan.code.topPt,
      r: plan.code.rightPt,
      b: plan.code.bottomPt,
    },
  ]
  return {
    L: ptMm(Math.min(...boxes.map((b) => b.l))),
    T: ptMm(Math.min(...boxes.map((b) => b.t))),
    R: ptMm(plan.widthPt - Math.max(...boxes.map((b) => b.r))),
    B: ptMm(plan.heightPt - Math.max(...boxes.map((b) => b.b))),
  }
}

const near = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE_MM)

describe('the final planners against the boards', () => {
  it('covers the twelve layouts, Europe, the long address, the ladder and every hard case', () => {
    const boards = new Set(golden.cards.map((card) => card.board))
    expect([...boards].sort()).toEqual([
      'badge-logo',
      'europe',
      'family',
      'long-address',
      'long-text',
      'no-logo',
      'no-photo',
      'scan-cue',
      'tile-ladder',
      'two-languages',
    ])
    expect(golden.cards.filter((card) => card.board === 'family')).toHaveLength(12)
    expect(golden.cards.filter((card) => card.board === 'scan-cue')).toHaveLength(20)
  })

  it.each(golden.cards.map((card) => [nameOf(card), card] as const))(
    '%s: the cue lines are each language’s cue, whole',
    (_, card) => {
      expect(card.cues).toEqual(
        card.langs.map((locale) => PRINT_FINAL_SCAN_CUE[locale as GuestLocale]),
      )
    },
  )

  it.each(golden.cards.map((card) => [nameOf(card), card] as const))(
    '%s: the tile and the cue lines are the board’s',
    (_, card) => {
      const tile = tileOf(card)
      expect(tile.tilePt / 72).toBeCloseTo(card.tileIn, 2)
      expect(planOf(card).code.bottomPt - planOf(card).code.topPt).toBeGreaterThan(
        tile.tilePt,
      )
      expect(cueLinesOf(card, tile.tilePt)).toEqual(card.cues)
      expect(card.cues).toHaveLength(card.cueLines)
    },
  )

  it.each(golden.cards.map((card) => [nameOf(card), card] as const))(
    '%s: every part and the code block land where the board put them',
    (_, card) => {
      const plan = planOf(card)
      expect(plan.problems).toEqual([])
      card.parts.forEach((part, index) => {
        const placed = plan.parts[index]
        expect(placed?.key).toBe(part.key)
        near(ptMm(placed?.xPt ?? NaN), part.l)
        near(ptMm(placed?.yPt ?? NaN), part.t)
      })
      near(ptMm(plan.code.leftPt), card.tile.l)
      near(ptMm(plan.code.topPt), card.tile.t)
      near(ptMm(plan.code.rightPt), card.tile.r)
      near(ptMm(plan.code.bottomPt), card.tile.b)
    },
  )

  it.each(golden.cards.map((card) => [nameOf(card), card] as const))(
    '%s: the ink margins and the group gaps match the board',
    (_, card) => {
      const plan = planOf(card)
      const margins = inkMarginsMm(plan)
      near(margins.L, card.margins.L)
      near(margins.R, card.margins.R)
      near(margins.T, card.margins.T)
      near(margins.B, card.margins.B)
      near(ptMm(plan.gapsPt.brandToMessage ?? NaN), card.gaps.brandToMessage)
      near(ptMm(plan.gapsPt.messageToCode), card.gaps.messageToCode)
    },
  )

  const photoCards = golden.cards.filter((card) => card.photo !== null)

  it.each(photoCards.map((card) => [nameOf(card), card] as const))(
    '%s: the photo’s box with bleed and its dpi are the board’s',
    (_, card) => {
      const photo = card.photo
      if (photo === null) throw new Error('a photo card has a photo')
      const box = printFinalPhotoBox(planOf(card))
      expect(box.coverWidthPt / 72).toBeCloseTo(photo.w, 1)
      expect(box.coverHeightPt / 72).toBeCloseTo(photo.h, 1)
      const [widthPx, heightPx] = photo.px
      expect(
        printFinalPhotoDpi({ widthPx: widthPx ?? 0, heightPx: heightPx ?? 0 }, box),
      ).toBe(photo.dpi)
    },
  )
})
