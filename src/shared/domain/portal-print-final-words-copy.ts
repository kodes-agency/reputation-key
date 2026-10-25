// What Share's Words step says about the call to action (final design spec §5.5,
// §5.7 and §8; the boards share-desktop-light, share-words-custom,
// share-words-two-languages and share-words-states): the print a wording was
// checked against, why a wording is greyed, how the manager's own words print,
// and the guide beside each field. Copy only, from the planner's answers
// (`portal-print-final-words-fit.ts`), so each line is tested as written.

import { GUEST_LOCALE_METADATA, type GuestLocale } from './guest-locale'
import type { PrintKitPaper } from './portal-print-kit'
import type {
  PrintFinalFace,
  PrintFinalOrientation,
  PrintFinalPiece,
} from './portal-print-final'
import { printFinalLanguageChoiceLabel } from './portal-print-final-languages'
import { PRINT_FINAL_PAPER_NAMES } from './portal-print-final-share'
import { printFinalHeadlineFloorPt } from './portal-print-final-type'
import type {
  PrintFinalEveryCardRow,
  PrintFinalMenuRow,
  PrintFinalWordsFit,
} from './portal-print-final-words-fit'

/**
 * The guide each counter names (§5.7, `cta-budget.json`): about 8 in 10 drafted
 * headlines of that length fit. A guide, never a limit: the planner's answer wins.
 *   - `headline`: one language;
 *   - `firstHeadline`: the first of two languages, kept to one line;
 *   - `subline`: a sub-line on one line;
 *   - `secondHeadline`: the second language's headline.
 */
export const PRINT_FINAL_WORDS_GUIDE: Readonly<
  Record<
    PrintFinalPiece,
    Readonly<
      Record<
        PrintFinalOrientation,
        Readonly<{
          headline: number
          firstHeadline: number
          subline: number
          secondHeadline: number
        }>
      >
    >
  >
> = Object.freeze({
  counter: {
    upright: { headline: 46, firstHeadline: 18, subline: 44, secondHeadline: 61 },
    wide: { headline: 42, firstHeadline: 17, subline: 40, secondHeadline: 56 },
  },
  tent: {
    upright: { headline: 30, firstHeadline: 15, subline: 29, secondHeadline: 31 },
    wide: { headline: 30, firstHeadline: 15, subline: 29, secondHeadline: 40 },
  },
  small: {
    upright: { headline: 30, firstHeadline: 17, subline: 30, secondHeadline: 32 },
    wide: { headline: 28, firstHeadline: 15, subline: 27, secondHeadline: 41 },
  },
})

/** Each piece in a sentence: one, many, and in "These words on every card". */
const PIECE_WORDS: Readonly<
  Record<PrintFinalPiece, Readonly<{ one: string; many: string; row: string }>>
> = Object.freeze({
  tent: { one: 'tent', many: 'tents', row: 'Table tent' },
  counter: { one: 'Counter card', many: 'Counter cards', row: 'Counter card' },
  small: { one: 'Small card', many: 'Small cards', row: 'Small card' },
})

const LOOK_WORDS = Object.freeze({ paper: 'Paper', immersive: 'Immersive' })

const otherOf = (orientation: PrintFinalOrientation): PrintFinalOrientation =>
  orientation === 'upright' ? 'wide' : 'upright'

const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

/** 16.5, 19: a size as the boards print it. */
const printFinalPtLabel = (pt: number): string => String(Number(pt.toFixed(1)))

const languageName = (locale: GuestLocale) => GUEST_LOCALE_METADATA[locale].nativeName

/** "upright Paper tents": the print a wording is checked against. */
const printFinalPrintWords = (
  face: Pick<PrintFinalFace, 'piece' | 'orientation' | 'look'>,
): string =>
  `${face.orientation} ${LOOK_WORDS[face.look]} ${PIECE_WORDS[face.piece].many}`

/** "upright Paper tents · Letter · English, then Español": the menu's header after "Call to action · ". */
export const printFinalCheckedAgainst = (
  face: Pick<PrintFinalFace, 'piece' | 'orientation' | 'look'>,
  paper: PrintKitPaper,
  languages: readonly GuestLocale[],
): string =>
  `${printFinalPrintWords(face)} · ${PRINT_FINAL_PAPER_NAMES[paper]} · ${printFinalLanguageChoiceLabel(languages)}`

/** " with two languages", " with Español first", or nothing with one language. */
function withLanguages(languages: readonly GuestLocale[]): string {
  const [first] = languages
  if (languages.length < 2 || first === undefined) return ''
  return first === 'en' ? ' with two languages' : ` with ${languageName(first)} first`
}

/** Why a wording is greyed in the menu, or null where it fits. */
export function printFinalMenuReason(
  row: PrintFinalMenuRow,
  face: Pick<PrintFinalFace, 'piece' | 'orientation' | 'look'>,
  languages: readonly GuestLocale[],
): string | null {
  if (row.state === 'held' && row.heldIn !== null) {
    return `Not available in ${languageName(row.heldIn)} yet`
  }
  if (row.state !== 'too_long') return null
  const two = languages.length > 1 ? ' with two languages' : ''
  return `Too long for ${printFinalPrintWords(face)}${two}`
}

/** The one note of a menu where no wording fits the print (§5.5, panel 13). */
export function printFinalNoWordingNote(
  face: Pick<PrintFinalFace, 'piece' | 'orientation' | 'look'>,
  paper: PrintKitPaper,
  languages: readonly GuestLocale[],
): string {
  const turn = `Choose ${capitalised(otherOf(face.orientation))}`
  const englishFirst =
    languages[0] !== 'en' && languages.includes('en') ? ', put English first' : ''
  return `No wording fits ${printFinalPrintWords(face)} on ${PRINT_FINAL_PAPER_NAMES[paper]}${withLanguages(languages)}. ${turn}${englishFirst}, or write your own shorter words.`
}

/** A picked wording that a later change made too long (§5.5, panel 14): the reason, then what helps. */
export function printFinalPickedTooLong(
  headline: string,
  face: Pick<PrintFinalFace, 'piece' | 'orientation' | 'look'>,
  languages: readonly GuestLocale[],
): Readonly<{ reason: string; help: string }> {
  return {
    reason: `“${headline}” is too long for ${printFinalPrintWords(face)}${withLanguages(languages)}.`,
    help: `Pick another wording, choose ${capitalised(otherOf(face.orientation))}, or write your own.`,
  }
}

/** A status under a field: its tone (an icon and words, never colour alone), its words and an extra line. */
export type PrintFinalFieldStatus = Readonly<{
  tone: 'positive' | 'neutral' | 'negative'
  text: string
  extra: string | null
}>

/** "Too long for upright tents.": what the other orientation says, or nothing. */
const otherNote = (
  face: Pick<PrintFinalFace, 'piece' | 'orientation'>,
  fit: PrintFinalWordsFit,
) =>
  fit.otherRefused
    ? `Too long for ${otherOf(face.orientation)} ${PIECE_WORDS[face.piece].many}.`
    : null

/** The status under the first headline (§5.7's table). `shortenBy` is the planner's cut; null falls back to the guide. */
export function printFinalHeadlineStatus(
  face: Pick<PrintFinalFace, 'piece' | 'orientation'>,
  fit: PrintFinalWordsFit,
  shortenBy: number | null,
  typed: number,
  languageCount: number,
): PrintFinalFieldStatus {
  const { one, many } = PIECE_WORDS[face.piece]
  const other = otherOf(face.orientation)
  if (fit.state === 'refused') {
    const guide = PRINT_FINAL_WORDS_GUIDE[face.piece][face.orientation]
    const n =
      shortenBy ??
      Math.max(1, typed - (languageCount > 1 ? guide.firstHeadline : guide.headline))
    const article = face.orientation === 'upright' ? 'an upright' : 'a wide'
    const floor = printFinalPtLabel(printFinalHeadlineFloorPt(face.piece))
    return {
      tone: 'negative',
      text: `Too long for ${article} ${one}, even at the smallest size (${floor} pt). Shorten by about ${n} character${n === 1 ? '' : 's'}.`,
      extra: fit.otherRefused ? null : `${capitalised(other)} ${many} take it.`,
    }
  }
  const pt = printFinalPtLabel(fit.headlinePt)
  if (fit.state === 'step') {
    return {
      tone: 'neutral',
      text: fit.steppedForOther
        ? `Prints at ${pt} pt, the size ${other} ${many} need`
        : `Prints at ${pt} pt`,
      extra: otherNote(face, fit),
    }
  }
  return {
    tone: 'positive',
    text: `Fits at full size (${pt} pt)`,
    extra: otherNote(face, fit),
  }
}

/** The headline's counter: "26 characters · guide 30 on a tent", or on a phone "26 · guide 30". */
export function printFinalHeadlineCounter(
  face: Pick<PrintFinalFace, 'piece' | 'orientation'>,
  typed: number,
  languageCount: number,
  compact: boolean,
): string {
  const guide = PRINT_FINAL_WORDS_GUIDE[face.piece][face.orientation]
  const two = languageCount > 1
  const n = two ? guide.firstHeadline : guide.headline
  if (compact) return `${typed} · guide ${n}`
  return two
    ? `${typed} characters · guide ${n} with two languages`
    : `${typed} characters · guide ${n} on a ${PIECE_WORDS[face.piece].one}`
}

/** The sub-line's status (§5.7): one line, two (allowed), more refused, or none. */
export function printFinalSublineStatus(
  typed: number,
  fit: PrintFinalWordsFit,
): PrintFinalFieldStatus {
  if (typed === 0)
    return { tone: 'neutral', text: 'No sub-line: the words close up', extra: null }
  if (fit.sublineLines > 2) {
    return {
      tone: 'negative',
      text: 'Too long: a sub-line prints on two lines at most',
      extra: null,
    }
  }
  return fit.sublineLines === 2
    ? { tone: 'neutral', text: 'Wraps to two lines', extra: null }
    : { tone: 'positive', text: 'Fits on one line', extra: null }
}

/** The second language's headline (§8): one small line, in full under a rule, or too long with both. */
export function printFinalSecondStatus(
  fit: PrintFinalWordsFit,
  first: GuestLocale,
  secondHeadlinePt: number,
): PrintFinalFieldStatus {
  if (fit.secondRefused) {
    return {
      tone: 'negative',
      text: 'Too long with both languages on this piece',
      extra: null,
    }
  }
  return fit.secondMode === 'line'
    ? {
        tone: 'positive',
        text: `Fits as one small line under the ${languageName(first)}`,
        extra: null,
      }
    : {
        tone: 'positive',
        text: `Fits (${printFinalPtLabel(secondHeadlinePt)} pt, under a short rule)`,
        extra: null,
      }
}

/** "16 · guide 29": a sub-line's or a second headline's counter. */
export const printFinalShortCounter = (typed: number, guide: number): string =>
  `${typed} · guide ${guide}`

/** The heading over a language's fields (§8). */
export const printFinalLanguageHeading = (locale: GuestLocale, index: number): string =>
  `${languageName(locale)} · ${index === 0 ? 'prints larger' : 'prints smaller, under a short rule'}`

/** The hint under the select with two languages (§8). */
export const printFinalTwoLanguagesHint = (first: GuestLocale): string =>
  `With two languages, keep the ${languageName(first)} headline to one line.`

/** One line of "These words on every card": "Table tent, wide" and "· prints at 16.5 pt". */
export function printFinalEveryCardLine(
  row: PrintFinalEveryCardRow,
  languages: readonly GuestLocale[],
): Readonly<{ name: string; detail: string }> {
  const detail =
    row.state === 'refused'
      ? 'too long'
      : row.state === 'step'
        ? `prints at ${printFinalPtLabel(row.headlinePt)} pt`
        : 'full size'
  const [, second] = languages
  const line =
    second !== undefined && row.secondMode === 'line' && row.state !== 'refused'
      ? `; ${languageName(second)} as one small line`
      : ''
  return {
    name: `${PIECE_WORDS[row.piece].row}, ${row.orientation}`,
    detail: `${detail}${line}`,
  }
}
