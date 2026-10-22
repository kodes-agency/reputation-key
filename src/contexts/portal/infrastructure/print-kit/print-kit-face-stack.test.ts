import { describe, expect, it } from 'vitest'
import { printKitFaces, type PrintKitWords } from '#/shared/domain/portal-print-kit'
import { STACK, mmToPt } from '#/shared/domain/portal-print-kit-measures'
import {
  layoutFaceStack,
  placeSizes,
  stackScales,
  type FaceStack,
} from './print-kit-face-stack'

const COLOURS = { ink: '#121614', soft: '#5C5650', accentInk: '#765B1D', rule: '#765B1D' }
const TITLES = { en: 'Pool & Terrace', es: 'Piscina y terraza' }
/** Half an em a character: enough to wrap like a font. */
const measure = (text: string, style: { size: number }) => text.length * style.size * 0.5

function stackFor(
  choice: PrintKitWords,
  scale: Parameters<typeof layoutFaceStack>[0]['scale'],
  maxWidthPt = 250,
) {
  const [face] = printKitFaces(choice, TITLES, 'Portal')
  return layoutFaceStack({
    blocks: face?.blocks ?? [],
    scale,
    maxWidthPt,
    colours: COLOURS,
    measure,
  })
}

const outline = (stack: FaceStack) =>
  stack.items.map((item) =>
    item.kind === 'rule'
      ? `rule ${item.colour}`
      : `${item.style.face} ${item.style.size} ${item.text}`,
  )

describe('the words of a face', () => {
  it('leads with the place label, the second language’s title under it, then each call to action about a rule', () => {
    const stack = stackFor(
      { piece: 'counter_card', languages: ['en', 'es'], callToAction: 'rate' },
      'two',
    )
    expect(outline(stack)).toEqual([
      'display 24 Pool & Terrace',
      'bodyStrong 9.5 Piscina y terraza',
      'display 18 Rate your visit',
      'body 10 Private, about 30 seconds',
      'rule #765B1D',
      'display 12.5 Valore su visita',
      'body 9.5 En privado, unos 30 segundos',
    ])
    expect(stack.first?.text).toBe('Pool & Terrace')
  })

  it('sets the second language’s title in the accent ink, tracked', () => {
    const stack = stackFor(
      { piece: 'counter_card', languages: ['en', 'es'], callToAction: 'rate' },
      'two',
    )
    const [, title] = stack.items
    expect(title?.kind === 'line' && title.style.colour).toBe(COLOURS.accentInk)
    expect(title?.kind === 'line' && title.style.spacing).toBeCloseTo(9.5 * 0.02, 10)
  })

  it('puts the rule between the place label and the call to action with one language', () => {
    const stack = stackFor(
      { piece: 'counter_card', languages: ['en'], callToAction: 'rate' },
      'one',
    )
    expect(outline(stack)).toEqual([
      'display 32 Pool & Terrace',
      'rule #765B1D',
      'display 22 Rate your visit',
      'body 12 Private, about 30 seconds',
    ])
  })

  it('stacks its lines in line boxes, with the boards’ gaps between them', () => {
    const stack = stackFor(
      { piece: 'counter_card', languages: ['en'], callToAction: 'rate' },
      'one',
    )
    const [place, rule, head, sub] = stack.items
    const ruleGap = STACK.gapsPt.one.rule
    expect(place?.topPt).toBe(0)
    expect(rule?.topPt).toBeCloseTo(32 * 0.96 + ruleGap, 10)
    expect(head?.topPt).toBeCloseTo(32 * 0.96 + 2 * ruleGap + STACK.rule.weightPt, 10)
    expect(sub?.topPt).toBeCloseTo((head?.topPt ?? 0) + 22 * 1.05 + mmToPt(0.7), 10)
    expect(stack.heightPt).toBeCloseTo((sub?.topPt ?? 0) + 12 * 1.25, 10)
  })

  it('draws the tent’s rule longer and heavier', () => {
    const stack = stackFor(
      { piece: 'table_tent', languages: ['en', 'es'], callToAction: 'rate' },
      'tent',
      400,
    )
    const rule = stack.items.find((item) => item.kind === 'rule')
    expect(rule?.widthPt).toBeCloseTo(mmToPt(12), 10)
    expect(rule?.kind === 'rule' && rule.weightPt).toBeCloseTo(mmToPt(0.4), 10)
  })

  it('balances a long place label over the lines it needs', () => {
    const [face] = printKitFaces(
      { piece: 'counter_card', languages: ['en'], callToAction: 'rate' },
      { en: 'Spa & Wellness Centre Lobby' },
      'Portal',
    )
    const stack = layoutFaceStack({
      blocks: face?.blocks ?? [],
      scale: 'one',
      maxWidthPt: 380,
      colours: COLOURS,
      measure,
    })
    const lines = stack.items.filter(
      (item) => item.kind === 'line' && item.style.size === 32,
    )
    expect(lines.map((line) => line.kind === 'line' && line.text)).toEqual([
      'Spa & Wellness',
      'Centre Lobby',
    ])
  })

  it('tries the full scale first, and steps two languages down once', () => {
    expect(stackScales(2, false)).toEqual(['two', 'twoTight'])
    expect(stackScales(1, false)).toEqual(['one'])
    expect(stackScales(2, true)).toEqual(['tent'])
  })

  it('shrinks the place label alone, from its scale’s size to the reading floor, when told to', () => {
    expect(placeSizes('two').slice(0, 3)).toEqual([24, 23.5, 23])
    expect(placeSizes('tent').at(-1)).toBe(9)
    const [face] = printKitFaces(
      { piece: 'counter_card', languages: ['en', 'es'], callToAction: 'rate' },
      TITLES,
      'Portal',
    )
    const stack = layoutFaceStack({
      blocks: face?.blocks ?? [],
      scale: 'two',
      placePt: 15,
      maxWidthPt: 250,
      colours: COLOURS,
      measure,
    })
    expect(outline(stack).slice(0, 3)).toEqual([
      'display 15 Pool & Terrace',
      'bodyStrong 9.5 Piscina y terraza',
      'display 18 Rate your visit',
    ])
  })
})
