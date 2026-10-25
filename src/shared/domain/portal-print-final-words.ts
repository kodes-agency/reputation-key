// What a final face says, and in which type (final design spec §3 and §8): the
// kicker (the page title, in the first language), the headline and its
// sub-line, and the second language, either in full under a short rule or as
// one small italic line. The Small card has no kicker, and a kicker the
// headline repeats is left out (§5.9). Each part carries the
// style it is set in and the tone it is painted in; the look turns a tone into
// a colour (Paper: ink, soft text and the accent ink).

import type { GuestLocale } from './guest-locale'
import type { PrintTextBlock } from './portal-print-kit'
import { printFinalLanguageMode, type PrintFinalFace } from './portal-print-final'
import { printFinalKickerRepeated } from './portal-print-final-kicker'
import type { PrintFinalPartKey } from './portal-print-final-parts'
import type { PrintFinalTextStyle } from './portal-print-final-text'
import {
  PRINT_FINAL_TYPE,
  PRINT_FINAL_TYPE_SETTINGS,
  printFinalKickerTrackingEm,
  printFinalSublineWeight,
} from './portal-print-final-type'

/** What a part is painted in: the ink of the headlines, the soft text of the sub-lines, the accent of the kicker. */
export type PrintFinalTone = 'ink' | 'soft' | 'accent'

export type PrintFinalWordsPart = Readonly<{
  key: Exclude<PrintFinalPartKey, 'brand' | 'rule' | 'name'>
  text: string
  locale: GuestLocale
  style: PrintFinalTextStyle
  tone: PrintFinalTone
}>

/** The headline's style at `sizePt`: Cormorant Garamond on the Counter card and the tent, Ysabeau Office on the Small card. */
function printFinalHeadlineStyle(
  face: PrintFinalFace,
  sizePt: number,
): PrintFinalTextStyle {
  const scale = PRINT_FINAL_TYPE[face.piece]
  return {
    family: scale.headlineFamily,
    weight: 600,
    italic: false,
    sizePt,
    trackingEm: scale.headlineTrackingEm,
    leading: scale.headlineLeading,
    caps: false,
  }
}

/** The sub-line's style: Ysabeau Office 400, turned 600 where it is reversed under 9 pt. */
function printFinalSublineStyle(
  face: PrintFinalFace,
  italic = false,
): PrintFinalTextStyle {
  return {
    family: 'sans',
    weight: printFinalSublineWeight(face.piece, face.look),
    italic,
    sizePt: PRINT_FINAL_TYPE[face.piece].sublinePt,
    trackingEm: 0,
    leading: PRINT_FINAL_TYPE_SETTINGS.subline.leading,
    caps: false,
  }
}

/** The kicker's style, or null on the Small card, which has none. */
function printFinalKickerStyle(face: PrintFinalFace): PrintFinalTextStyle | null {
  const sizePt = PRINT_FINAL_TYPE[face.piece].kickerPt
  if (sizePt === null) return null
  return {
    family: 'sans',
    weight: 600,
    italic: false,
    sizePt,
    trackingEm: printFinalKickerTrackingEm(face.look, face.orientation),
    leading: PRINT_FINAL_TYPE_SETTINGS.kicker.leading,
    caps: true,
  }
}

/** The property's name in tracked capitals, when there is no logo. */
export function printFinalWordmarkStyle(face: PrintFinalFace): PrintFinalTextStyle {
  const { wordmark } = PRINT_FINAL_TYPE_SETTINGS
  return {
    family: 'serif',
    weight: 600,
    italic: false,
    sizePt: PRINT_FINAL_TYPE[face.piece].wordmarkPt,
    trackingEm: wordmark.trackingEm,
    leading: wordmark.leading,
    caps: true,
  }
}

/** The back page's property name: Ysabeau Office 600 in tracked capitals, smaller than the wordmark (§10.4). */
export function printFinalNameStyle(face: PrintFinalFace): PrintFinalTextStyle {
  const { name } = PRINT_FINAL_TYPE_SETTINGS
  return {
    family: 'sans',
    weight: 600,
    italic: false,
    sizePt: PRINT_FINAL_TYPE[face.piece].namePt,
    trackingEm: name.trackingEm,
    leading: name.leading,
    caps: true,
  }
}

/** The second language: in full (its headline smaller, then its sub-line) or one small italic line. */
function secondLanguage(
  face: PrintFinalFace,
  second: PrintTextBlock,
  mode: 'stack' | 'line',
): readonly PrintFinalWordsPart[] {
  const { locale } = second
  if (mode === 'line') {
    const style = printFinalSublineStyle(face, true)
    return [{ key: 'secondLine', text: second.headline, locale, style, tone: 'soft' }]
  }
  const headlinePt = PRINT_FINAL_TYPE[face.piece].secondHeadlinePt
  return [
    {
      key: 'headline2',
      text: second.headline,
      locale,
      style: printFinalHeadlineStyle(face, headlinePt),
      tone: 'ink',
    },
    {
      key: 'subline2',
      text: second.subline,
      locale,
      style: printFinalSublineStyle(face),
      tone: 'soft',
    },
  ]
}

/**
 * The words of a face, top to bottom, with the headline at `headlinePt`. The
 * rule before a second language in full is not a word: `rule` says where it goes
 * (after the first sub-line), and the face draws it.
 */
export function printFinalWords(
  face: PrintFinalFace,
  blocks: readonly PrintTextBlock[],
  headlinePt: number,
): Readonly<{ words: readonly PrintFinalWordsPart[]; rule: boolean }> {
  const [first, second] = blocks
  if (first === undefined)
    throw new Error('A face says something in one language at least')
  const { locale } = first
  const kickerStyle = printFinalKickerStyle(face)
  const kicker = printFinalKickerRepeated(first.kicker, first.headline)
    ? null
    : kickerStyle
  const words: PrintFinalWordsPart[] = [
    ...(kicker === null
      ? []
      : [
          {
            key: 'kicker',
            text: first.kicker,
            locale,
            style: kicker,
            tone: 'accent',
          } as const,
        ]),
    {
      key: 'headline',
      text: first.headline,
      locale,
      style: printFinalHeadlineStyle(face, headlinePt),
      tone: 'ink',
    },
    {
      key: 'subline',
      text: first.subline,
      locale,
      style: printFinalSublineStyle(face),
      tone: 'soft',
    },
  ]
  const mode = printFinalLanguageMode(face, blocks.length)
  if (second === undefined || mode === 'one') return { words, rule: false }
  return {
    words: [...words, ...secondLanguage(face, second, mode)],
    rule: mode === 'stack',
  }
}
