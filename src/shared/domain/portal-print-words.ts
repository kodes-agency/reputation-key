// What a face says, and in which type (design spec §3 and §8): the
// kicker (the page title, in the first language), the headline and its
// sub-line, and the second language, either in full under a short rule or as
// one small italic line. The Small card has no kicker, and a kicker the
// headline repeats is left out (§5.9). Each part carries the
// style it is set in and the tone it is painted in; the look turns a tone into
// a colour (Paper: ink, soft text and the accent ink).

import type { GuestLocale } from './guest-locale'
import type { PrintTextBlock } from './portal-print-kit'
import { printLanguageMode, type PrintFace } from './portal-print'
import { printKickerRepeated } from './portal-print-kicker'
import type { PrintPartKey } from './portal-print-parts'
import type { PrintTextStyle } from './portal-print-text'
import {
  PRINT_TYPE,
  PRINT_TYPE_SETTINGS,
  printKickerTrackingEm,
  printSublineWeight,
} from './portal-print-type'

/** What a part is painted in: the ink of the headlines, the soft text of the sub-lines, the accent of the kicker. */
export type PrintTone = 'ink' | 'soft' | 'accent'

export type PrintWordsPart = Readonly<{
  key: Exclude<PrintPartKey, 'brand' | 'rule' | 'name'>
  text: string
  locale: GuestLocale
  style: PrintTextStyle
  tone: PrintTone
}>

/** The headline's style at `sizePt`: Cormorant Garamond on the Counter card and the tent, Ysabeau Office on the Small card. */
function printHeadlineStyle(face: PrintFace, sizePt: number): PrintTextStyle {
  const scale = PRINT_TYPE[face.piece]
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
function printSublineStyle(face: PrintFace, italic = false): PrintTextStyle {
  return {
    family: 'sans',
    weight: printSublineWeight(face.piece, face.look),
    italic,
    sizePt: PRINT_TYPE[face.piece].sublinePt,
    trackingEm: 0,
    leading: PRINT_TYPE_SETTINGS.subline.leading,
    caps: false,
  }
}

/** The kicker's style, or null on the Small card, which has none. */
function printKickerStyle(face: PrintFace): PrintTextStyle | null {
  const sizePt = PRINT_TYPE[face.piece].kickerPt
  if (sizePt === null) return null
  return {
    family: 'sans',
    weight: 600,
    italic: false,
    sizePt,
    trackingEm: printKickerTrackingEm(face.look, face.orientation),
    leading: PRINT_TYPE_SETTINGS.kicker.leading,
    caps: true,
  }
}

/** The property's name in tracked capitals, when there is no logo. */
export function printWordmarkStyle(face: PrintFace): PrintTextStyle {
  const { wordmark } = PRINT_TYPE_SETTINGS
  return {
    family: 'serif',
    weight: 600,
    italic: false,
    sizePt: PRINT_TYPE[face.piece].wordmarkPt,
    trackingEm: wordmark.trackingEm,
    leading: wordmark.leading,
    caps: true,
  }
}

/** The back page's property name: Ysabeau Office 600 in tracked capitals, smaller than the wordmark (§10.4). */
export function printNameStyle(face: PrintFace): PrintTextStyle {
  const { name } = PRINT_TYPE_SETTINGS
  return {
    family: 'sans',
    weight: 600,
    italic: false,
    sizePt: PRINT_TYPE[face.piece].namePt,
    trackingEm: name.trackingEm,
    leading: name.leading,
    caps: true,
  }
}

/** The second language: in full (its headline smaller, then its sub-line) or one small italic line. */
function secondLanguage(
  face: PrintFace,
  second: PrintTextBlock,
  mode: 'stack' | 'line',
): readonly PrintWordsPart[] {
  const { locale } = second
  if (mode === 'line') {
    const style = printSublineStyle(face, true)
    return [{ key: 'secondLine', text: second.headline, locale, style, tone: 'soft' }]
  }
  const headlinePt = PRINT_TYPE[face.piece].secondHeadlinePt
  return [
    {
      key: 'headline2',
      text: second.headline,
      locale,
      style: printHeadlineStyle(face, headlinePt),
      tone: 'ink',
    },
    {
      key: 'subline2',
      text: second.subline,
      locale,
      style: printSublineStyle(face),
      tone: 'soft',
    },
  ]
}

/**
 * The words of a face, top to bottom, with the headline at `headlinePt`. The
 * rule before a second language in full is not a word: `rule` says where it goes
 * (after the first sub-line), and the face draws it.
 */
export function printWords(
  face: PrintFace,
  blocks: readonly PrintTextBlock[],
  headlinePt: number,
): Readonly<{ words: readonly PrintWordsPart[]; rule: boolean }> {
  const [first, second] = blocks
  if (first === undefined)
    throw new Error('A face says something in one language at least')
  const { locale } = first
  const kickerStyle = printKickerStyle(face)
  const kicker = printKickerRepeated(first.kicker, first.headline) ? null : kickerStyle
  const words: PrintWordsPart[] = [
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
      style: printHeadlineStyle(face, headlinePt),
      tone: 'ink',
    },
    {
      key: 'subline',
      text: first.subline,
      locale,
      style: printSublineStyle(face),
      tone: 'soft',
    },
  ]
  const mode = printLanguageMode(face, blocks.length)
  if (second === undefined || mode === 'one') return { words, rule: false }
  return {
    words: [...words, ...secondLanguage(face, second, mode)],
    rule: mode === 'stack',
  }
}
