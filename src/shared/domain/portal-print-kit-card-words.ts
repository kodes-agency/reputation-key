// The words of a card in the round-2 order (round-2 spec-delta R2, round-3 S3):
// the property name under a logo, then the message group: the eyebrow (the
// portal's title, small tracked capitals), the call to action (the largest line
// on the face), its sub-line and, with two languages, a short rule and the second
// language's call to action alone (R5). The portal's title prints once, with a
// translated title joined on the same line: "RECEPTION · RECEPCIÓN".
//
// Laid out from the top of each group in points, as the boards' flex column lays
// it out: every line in a box of its size times its leading, the gaps the size's
// tokens (`FACE_SPACING`). Pure, and measured by the caller: the PDF measures in
// the fonts it embeds, the Share tab's preview from its width tables, and both
// break the lines here, so the preview shows the lines the file prints.

import type { GuestLocale } from './guest-locale'
import type { PrintTextBlock } from './portal-print-kit'
import { stripUnsupportedCharacters } from './portal-print-kit-font-ranges'
import { mmToPt } from './portal-print-kit-measures'
import type { FaceSpacing } from './portal-print-kit-sizes'
import { balanceWords, fillWords, fitFontSize } from './portal-print-kit-text'

/** The two families: Cormorant for the call to action, Ysabeau for everything else. */
export type CardTextFace = 'display' | 'body' | 'bodyStrong'

export type CardTextStyle = Readonly<{
  face: CardTextFace
  sizePt: number
  /** Extra space after every character, in ems; negative tightens. */
  trackingEm: number
}>

/** The width of `text` set in `style`, in points, tracking after the last character not counted. */
export type CardTextMeasure = (text: string, style: CardTextStyle) => number

export type CardTextRole = 'wordmark' | 'name' | 'eyebrow' | 'cta' | 'sub' | 'cta2'

/** How each role is set, as the boards set it. */
export const CARD_TEXT = {
  /** The brand with no logo: Cormorant caps on a box close to their cap height, 15 pt before a second line. */
  wordmark: {
    face: 'display',
    trackingEm: 0.16,
    leading: 0.75,
    floorPt: 15,
    pitchEm: 1.2,
  },
  /** Ysabeau 600 caps, balanced, up to two lines; it shrinks toward 7 pt only to keep two. */
  name: { face: 'bodyStrong', trackingEm: 0.12, leading: 1.22, floorPt: 7, maxLines: 2 },
  /** Ysabeau 600 caps on one line; it shrinks to 9 pt before it may wrap. */
  eyebrow: { face: 'bodyStrong', trackingEm: 0.14, leading: 1.15, floorPt: 9 },
  cta: { face: 'display', trackingEm: -0.005, leading: 1 },
  sub: { face: 'body', trackingEm: 0, leading: 1.25 },
  cta2: { face: 'display', trackingEm: 0, leading: 1.08 },
  /** Between the two languages, after the sub-line. */
  rule: { widthPt: mmToPt(8), weightPt: mmToPt(0.35) },
} as const

export type CardLine = Readonly<{
  kind: 'line'
  role: CardTextRole
  text: string
  locale: GuestLocale | null
  style: CardTextStyle
  /** The top of the line's box, from the top of its group (or of the face, once placed). */
  topPt: number
  heightPt: number
  widthPt: number
}>

export type CardRule = Readonly<{
  kind: 'rule'
  topPt: number
  widthPt: number
  weightPt: number
}>

export type CardWords = Readonly<{
  items: readonly (CardLine | CardRule)[]
  heightPt: number
}>

/** The sizes a message is set at: a fit step's (`portal-print-kit-card-fit.ts`). */
export type CardMessageType = Readonly<{
  eyebrowPt: number
  ctaPt: number
  /** How small the call to action may go to stay on one line; null to wrap at `ctaPt`. */
  ctaOneLineFloorPt: number | null
  subPt: number
  cta2Pt: number
}>

type Cursor = { y: number; items: (CardLine | CardRule)[] }

export const cardTextStyle = (role: CardTextRole, sizePt: number): CardTextStyle => ({
  face: CARD_TEXT[role].face,
  sizePt,
  trackingEm: CARD_TEXT[role].trackingEm,
})

function pushLines(
  cursor: Cursor,
  line: Readonly<{ role: CardTextRole; locale: GuestLocale | null; sizePt: number }>,
  lines: readonly string[],
  measure: CardTextMeasure,
): void {
  const style = cardTextStyle(line.role, line.sizePt)
  const heightPt = line.sizePt * CARD_TEXT[line.role].leading
  for (const text of lines) {
    cursor.items.push({
      kind: 'line',
      role: line.role,
      text,
      locale: line.locale,
      style,
      topPt: cursor.y,
      heightPt,
      widthPt: measure(text, style),
    })
    cursor.y += heightPt
  }
}

const widthIn =
  (measure: CardTextMeasure, role: CardTextRole, sizePt: number) => (text: string) =>
    measure(text, cardTextStyle(role, sizePt))

/**
 * The property name in capitals, balanced into two lines at most, breaking at
 * a space or after a hyphen: a name that would need a third line shrinks, a
 * quarter point at a time, toward 7 pt.
 */
export function layoutCardName(
  name: string,
  sizePt: number,
  widthPt: number,
  measure: CardTextMeasure,
): CardWords {
  const text = stripUnsupportedCharacters(name).toUpperCase().trim()
  if (text === '') return { items: [], heightPt: 0 }
  const { floorPt, maxLines } = CARD_TEXT.name
  let size = sizePt
  // A name breaks after a hyphen too, as the boards' browser breaks it.
  const balanced = (at: number) =>
    balanceWords(text, widthPt, widthIn(measure, 'name', at), 'spaces-and-hyphens')
  let lines = balanced(size)
  while (lines.length > maxLines && size > floorPt) {
    size = Math.max(floorPt, size - 0.25)
    lines = balanced(size)
  }
  const cursor: Cursor = { y: 0, items: [] }
  pushLines(cursor, { role: 'name', locale: null, sizePt: size }, lines, measure)
  return { items: cursor.items, heightPt: cursor.y }
}

/** The portal's title once, with a different second-language title after a middle dot. */
function eyebrowText(lead: PrintTextBlock, second: PrintTextBlock | undefined): string {
  const first = lead.kicker.trim().toLocaleUpperCase(lead.locale)
  const other = second?.kicker.trim().toLocaleUpperCase(second.locale)
  const joined = other === undefined || other === first ? first : `${first} · ${other}`
  return stripUnsupportedCharacters(joined)
}

function pushEyebrow(
  cursor: Cursor,
  blocks: readonly PrintTextBlock[],
  sizePt: number,
  widthPt: number,
  measure: CardTextMeasure,
): void {
  const [lead, second] = blocks
  if (lead === undefined) return
  const text = eyebrowText(lead, second)
  const size = fitFontSize({
    size: sizePt,
    minSize: Math.min(sizePt, CARD_TEXT.eyebrow.floorPt),
    maxWidth: widthPt,
    widthAt: (at) => measure(text, cardTextStyle('eyebrow', at)),
  })
  const width = widthIn(measure, 'eyebrow', size)
  const lines = width(text) <= widthPt ? [text] : fillWords(text, widthPt, width)
  pushLines(
    cursor,
    { role: 'eyebrow', locale: lead.locale, sizePt: size },
    lines,
    measure,
  )
}

/** The call to action: balanced at its size, or on one line down to its one-line floor. */
function pushCallToAction(
  cursor: Cursor,
  block: PrintTextBlock,
  type: CardMessageType,
  widthPt: number,
  measure: CardTextMeasure,
): void {
  const text = stripUnsupportedCharacters(block.headline)
  const floor = type.ctaOneLineFloorPt
  const oneLine =
    floor === null
      ? null
      : fitFontSize({
          size: type.ctaPt,
          minSize: Math.min(floor, type.ctaPt),
          maxWidth: widthPt,
          widthAt: (at) => measure(text, cardTextStyle('cta', at)),
        })
  const fits = oneLine !== null && measure(text, cardTextStyle('cta', oneLine)) <= widthPt
  const sizePt = fits ? oneLine : type.ctaPt
  const lines = fits
    ? [text]
    : balanceWords(text, widthPt, widthIn(measure, 'cta', type.ctaPt))
  pushLines(cursor, { role: 'cta', locale: block.locale, sizePt }, lines, measure)
}

/**
 * The message group of a face: the eyebrow (left out where `eyebrow` is false),
 * the call to action, its sub-line and, for a second language, the rule and its
 * call to action.
 */
export function layoutCardMessage(
  input: Readonly<{
    blocks: readonly PrintTextBlock[]
    type: CardMessageType
    spacing: FaceSpacing
    widthPt: number
    eyebrow: boolean
    measure: CardTextMeasure
  }>,
): CardWords {
  const { blocks, type, spacing, widthPt, measure } = input
  const [lead, second] = blocks
  const cursor: Cursor = { y: 0, items: [] }
  if (lead === undefined) return { items: [], heightPt: 0 }
  if (input.eyebrow && spacing.eyebrowToCtaPt !== null) {
    pushEyebrow(cursor, blocks, type.eyebrowPt, widthPt, measure)
    cursor.y += spacing.eyebrowToCtaPt
  }
  pushCallToAction(cursor, lead, type, widthPt, measure)
  cursor.y += spacing.ctaToSubPt
  const sub = stripUnsupportedCharacters(lead.subline)
  const subLines = fillWords(sub, widthPt, widthIn(measure, 'sub', type.subPt))
  pushLines(
    cursor,
    { role: 'sub', locale: lead.locale, sizePt: type.subPt },
    subLines,
    measure,
  )
  if (second !== undefined && spacing.secondLanguage !== null) {
    cursor.y += spacing.secondLanguage.gapPt
    const { widthPt: ruleWidth, weightPt } = CARD_TEXT.rule
    cursor.items.push({ kind: 'rule', topPt: cursor.y, widthPt: ruleWidth, weightPt })
    cursor.y += weightPt + spacing.secondLanguage.ruleToCtaPt
    const text = stripUnsupportedCharacters(second.headline)
    const lines = balanceWords(text, widthPt, widthIn(measure, 'cta2', type.cta2Pt))
    pushLines(
      cursor,
      { role: 'cta2', locale: second.locale, sizePt: type.cta2Pt },
      lines,
      measure,
    )
  }
  return { items: cursor.items, heightPt: cursor.y }
}

/** A group's items moved down by `topPt`, to stand on the face. */
export function placeCardWords(
  words: CardWords,
  topPt: number,
): readonly (CardLine | CardRule)[] {
  return words.items.map((item) => ({ ...item, topPt: item.topPt + topPt }))
}
