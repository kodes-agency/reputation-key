// The words of a redesigned face (spec 2.2): the place label, the largest type
// on the face, with the second language's title small under it; the lead call to
// action; and, with two languages, a rule and the second call to action. With
// one language the rule sits between the place label and the call to action.
//
// Laid out from the top of the stack in points, as the design boards' flex column
// lays it out: every line in a line box of its type size times its leading, the
// gaps the boards' margins. The place label and the headlines are balanced
// across the lines they need, as `text-wrap: balance` sets them; a subline fills
// its lines. The caller places the stack on the face: centred on a card,
// left-aligned in the Paper tent's words column.

import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import { STACK, TYPE_PT } from '#/shared/domain/portal-print-kit-measures'
import { balanceWords, fillWords } from '#/shared/domain/portal-print-kit-text'
import { drawLine, type PdfTextStyle, type PrintKitFonts } from './print-kit-pdf-text'

/** The type scales a stack is set in (spec 2.2, and fit step c's `twoTight`). */
export type StackScale = keyof typeof TYPE_PT

export type FaceStackColours = Readonly<{
  /** The place label and the headlines. */
  ink: string
  /** The sublines. */
  soft: string
  /** The second language's title. */
  accentInk: string
  /** The rule: Paper's accent ink, Immersive's accent line. */
  rule: string
}>

export type FaceStackLine = Readonly<{
  kind: 'line'
  text: string
  style: PdfTextStyle
  /** The top of the line's box, from the top of the stack. */
  topPt: number
  heightPt: number
  widthPt: number
}>

export type FaceStackRule = Readonly<{
  kind: 'rule'
  /** The top of the rule, from the top of the stack. */
  topPt: number
  widthPt: number
  weightPt: number
  colour: string
}>

export type FaceStack = Readonly<{
  items: readonly (FaceStackLine | FaceStackRule)[]
  heightPt: number
  /** The first line: the place label, whose cap line the Paper tent's code sits on. */
  first: FaceStackLine | null
}>

type Measure = (text: string, style: PdfTextStyle) => number

export type FaceStackInput = Readonly<{
  blocks: readonly PrintTextBlock[]
  scale: StackScale
  maxWidthPt: number
  colours: FaceStackColours
  measure: Measure
}>

type Cursor = { y: number; items: (FaceStackLine | FaceStackRule)[] }

const style = (
  face: PdfTextStyle['face'],
  size: number,
  colour: string,
  trackingEm = 0,
): PdfTextStyle => ({ face, size, spacing: size * trackingEm, colour, opacity: 1 })

/** Lines of `text` at `textStyle`: balanced like a heading, or filled like a paragraph. */
function pushText(
  cursor: Cursor,
  input: FaceStackInput,
  text: string,
  textStyle: PdfTextStyle,
  leading: number,
): void {
  const width = (line: string) => input.measure(line, textStyle)
  const wrap = textStyle.face === 'display' ? balanceWords : fillWords
  const lines = wrap(text, input.maxWidthPt, width)
  const heightPt = textStyle.size * leading
  for (const line of lines) {
    cursor.items.push({
      kind: 'line',
      text: line,
      style: textStyle,
      topPt: cursor.y,
      heightPt,
      widthPt: width(line),
    })
    cursor.y += heightPt
  }
}

/** A rule with `gap` above and below it. The tent's rule is longer and heavier. */
function pushRule(cursor: Cursor, input: FaceStackInput, gap: number): void {
  const tent = input.scale === 'tent'
  cursor.y += gap
  cursor.items.push({
    kind: 'rule',
    topPt: cursor.y,
    widthPt: tent ? STACK.rule.tentWidthPt : STACK.rule.widthPt,
    weightPt: tent ? STACK.rule.tentWeightPt : STACK.rule.weightPt,
    colour: input.colours.rule,
  })
  cursor.y += (tent ? STACK.rule.tentWeightPt : STACK.rule.weightPt) + gap
}

/** The gaps of a scale: the rule's margin, and from the place block to the call to action. */
function gapsOf(scale: StackScale): Readonly<{ rule: number; placeToHead: number }> {
  if (scale === 'one') return { rule: STACK.gapsPt.one.rule, placeToHead: 0 }
  return STACK.gapsPt[scale]
}

/** The words of a face at a scale, placed from the top of the stack. */
export function layoutFaceStack(input: FaceStackInput): FaceStack {
  const [lead, second] = input.blocks
  const cursor: Cursor = { y: 0, items: [] }
  if (lead === undefined) return { items: [], heightPt: 0, first: null }
  const type = TYPE_PT[input.scale]
  const { colours } = input
  const gaps = gapsOf(input.scale)
  const { leading, trackingEm } = STACK
  pushText(
    cursor,
    input,
    lead.kicker,
    style('display', type.place, colours.ink, trackingEm.place),
    leading.place,
  )
  if (second !== undefined && 'place2' in type) {
    cursor.y += STACK.placeGapPt
    pushText(
      cursor,
      input,
      second.kicker,
      style('bodyStrong', type.place2, colours.accentInk, trackingEm.place2),
      leading.place2,
    )
    cursor.y += gaps.placeToHead
  } else {
    pushRule(cursor, input, gaps.rule)
  }
  pushText(
    cursor,
    input,
    lead.headline,
    style('display', type.head, colours.ink),
    leading.head,
  )
  cursor.y += STACK.subAbovePt
  pushText(
    cursor,
    input,
    lead.subline,
    style('body', type.sub, colours.soft),
    leading.sub,
  )
  if (second !== undefined && 'head2' in type) {
    pushRule(cursor, input, gaps.rule)
    pushText(
      cursor,
      input,
      second.headline,
      style('display', type.head2, colours.ink),
      leading.head2,
    )
    cursor.y += STACK.sub2AbovePt
    pushText(
      cursor,
      input,
      second.subline,
      style('body', type.sub2, colours.soft),
      leading.sub2,
    )
  }
  const first = cursor.items.find((item): item is FaceStackLine => item.kind === 'line')
  return { items: cursor.items, heightPt: cursor.y, first: first ?? null }
}

/** The scales a stack tries, largest first: two languages may step down once (fit step c). */
export function stackScales(languages: number, tent: boolean): readonly StackScale[] {
  if (tent) return ['tent']
  return languages > 1 ? ['two', 'twoTight'] : ['one']
}

export type PlacedStack = Readonly<{
  stack: FaceStack
  /** The column the stack is set in: its left edge, its width and its top. */
  x: number
  y: number
  widthPt: number
  align: 'centre' | 'start'
}>

/** Draws a stack in its column: each line and rule centred in it, or from its left edge. */
export function drawFaceStack(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  placed: PlacedStack,
): void {
  for (const item of placed.stack.items) {
    const x =
      placed.align === 'centre'
        ? placed.x + (placed.widthPt - item.widthPt) / 2
        : placed.x
    const top = placed.y + item.topPt
    if (item.kind === 'rule') {
      doc.save()
      doc.rect(x, top, item.widthPt, item.weightPt).fill(item.colour)
      doc.restore()
      continue
    }
    drawLine(doc, fonts, item.text, item.style, { x, middleY: top + item.heightPt / 2 })
  }
}
