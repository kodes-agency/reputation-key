// What the final kit's call to action says, per language (final design spec
// 2026-10-25 §5.5): the five wordings of Share's menu, each a headline and the
// sub-line under it. Today's kit keeps its own table (`PRINT_KIT_COPY`) and its
// own two ids; the final kit reads this one.
//
// The default says "How did we do?" over "About 30 seconds". The owner decided it
// among the recommended options of the call-to-action brainstorm: neutral
// wording, asked of every guest the same way (Google does not allow a card that
// asks only for good reviews, or that discourages bad ones), no stars, and no
// "private" or "privately" in any language (fixed rule NP: on a review card a
// privacy word can read as steering unhappy guests away from Google; the guest
// page dropped the adverb too on 2026-10-26: it says "Send", and "private note"
// only where it names that feature).
//
// "How was your stay?" (2026-10-27, the owner's wording for lodging) reads as
// its own pair: its sub-line is "Share your experience", not the 30 seconds,
// because the stay card does not promise a duration.
//
// The ids are the menu's, in menu order. A print keeps its wording's id even
// when the manager writes their own words: it records where the words started.
// The first final kit stored `rate` (which printed "How did we do?") and `tell`;
// migration 0072 turned them into `how_did_we_do` and `how_was_visit`.
//
// "About 30 seconds" is true only while the guest page really takes about that
// long, from the scan to the end of the rating. If it does not, the sub-line
// becomes "A minute or less" in every language (drafts: es "Un minuto o menos",
// it "Un minuto o meno", fr "Une minute ou moins", de "Eine Minute oder weniger",
// bg "Минута или по-малко"); that is one edit of this table.
//
// Every non-English string is a draft that no native speaker has checked yet
// (slice C9, the owner's). Drafts print, as the closed beta allows and as the
// first final kit already did, except where rule F holds them back (below).
// French takes a no-break space (U+00A0) before "?" so a line never starts with
// it.

import type { GuestLocale } from './guest-locale'
import type { PrintKitCopy } from './portal-print-kit'

/** The wordings Share offers, in menu order; the first is the default. */
export const PRINT_FINAL_CALLS_TO_ACTION = Object.freeze([
  'how_did_we_do',
  'how_was_visit',
  'how_was_stay',
  'rate_visit',
  'got_30_seconds',
] as const)
export type PrintFinalCallToAction = (typeof PRINT_FINAL_CALLS_TO_ACTION)[number]

export const PRINT_FINAL_DEFAULT_CALL_TO_ACTION: PrintFinalCallToAction = 'how_did_we_do'

/** Every wording but "Got 30 seconds?" and "How was your stay?" shares this sub-line. */
const ABOUT_30_SECONDS: Readonly<Record<GuestLocale, string>> = Object.freeze({
  en: 'About 30 seconds',
  es: 'Unos 30 segundos',
  it: 'Circa 30 secondi',
  fr: 'Environ 30 secondes',
  de: 'Etwa 30 Sekunden',
  bg: 'Около 30 секунди',
})

/** The sub-lines that are not "About 30 seconds", each wording's own. */
type OwnSublines = Readonly<{ how_was_stay: string; got_30_seconds: string }>

const copyOf = (
  locale: GuestLocale,
  headlines: Readonly<Record<PrintFinalCallToAction, string>>,
  own: OwnSublines,
): Readonly<Record<PrintFinalCallToAction, PrintKitCopy>> => {
  const subline = ABOUT_30_SECONDS[locale]
  return {
    how_did_we_do: { headline: headlines.how_did_we_do, subline },
    how_was_visit: { headline: headlines.how_was_visit, subline },
    how_was_stay: { headline: headlines.how_was_stay, subline: own.how_was_stay },
    rate_visit: { headline: headlines.rate_visit, subline },
    got_30_seconds: { headline: headlines.got_30_seconds, subline: own.got_30_seconds },
  }
}

export const PRINT_FINAL_COPY: Readonly<
  Record<GuestLocale, Readonly<Record<PrintFinalCallToAction, PrintKitCopy>>>
> = Object.freeze({
  en: copyOf(
    'en',
    {
      how_did_we_do: 'How did we do?',
      how_was_visit: 'How was your visit?',
      how_was_stay: 'How was your stay?',
      rate_visit: 'Rate your visit',
      got_30_seconds: 'Got 30 seconds?',
    },
    { how_was_stay: 'Share your experience', got_30_seconds: 'Tell us how it went' },
  ),
  es: copyOf(
    'es',
    {
      how_did_we_do: '¿Cómo lo hicimos?',
      how_was_visit: '¿Qué tal su visita?',
      how_was_stay: '¿Qué tal su estancia?',
      // Spain's register, as today's kit; "Califique su visita" is the US one (§13 item 16).
      rate_visit: 'Valore su visita',
      got_30_seconds: '¿Tiene 30 segundos?',
    },
    {
      how_was_stay: 'Comparta su experiencia',
      got_30_seconds: 'Cuéntenos qué tal le fue',
    },
  ),
  it: copyOf(
    'it',
    {
      how_did_we_do: 'Come siamo andati?',
      how_was_visit: 'Com’è andata la sua visita?',
      how_was_stay: 'Com’è stato il suo soggiorno?',
      rate_visit: 'Valuti la sua visita',
      got_30_seconds: 'Ha 30 secondi?',
    },
    {
      how_was_stay: 'Condivida la sua esperienza',
      got_30_seconds: 'Ci dica com’è andata',
    },
  ),
  fr: copyOf(
    'fr',
    {
      how_did_we_do: 'Votre avis sur nous\u00a0?',
      how_was_visit: 'Comment était votre visite\u00a0?',
      how_was_stay: 'Comment était votre séjour\u00a0?',
      rate_visit: 'Évaluez votre visite',
      got_30_seconds: 'Vous avez 30 secondes\u00a0?',
    },
    {
      how_was_stay: 'Partagez votre expérience',
      got_30_seconds: 'Dites-nous comment c’était',
    },
  ),
  de: copyOf(
    'de',
    {
      how_did_we_do: 'Wie war es bei uns?',
      how_was_visit: 'Wie war Ihr Besuch?',
      how_was_stay: 'Wie war Ihr Aufenthalt?',
      rate_visit: 'Bewerten Sie Ihren Besuch',
      got_30_seconds: 'Haben Sie 30 Sekunden?',
    },
    {
      how_was_stay: 'Teilen Sie Ihre Erfahrung',
      got_30_seconds: 'Sagen Sie uns, wie es war',
    },
  ),
  bg: copyOf(
    'bg',
    {
      how_did_we_do: 'Как беше при нас?',
      how_was_visit: 'Как мина посещението ви?',
      how_was_stay: 'Как мина престоят ви?',
      rate_visit: 'Оценете посещението си',
      got_30_seconds: 'Имате ли 30 секунди?',
    },
    { how_was_stay: 'Споделете впечатленията си', got_30_seconds: 'Кажете ни как мина' },
  ),
})

/**
 * How far each wording's copy in a language has come (§5.5):
 *   - `checked`: English, the language the owner reads;
 *   - `draft`: prints, but no native speaker has checked it (the † drafts, with a
 *     specific doubt, are fr, de and bg "How did we do?" and fr "Got 30 seconds?").
 *     "How was your stay?" is a draft in every language but English and is held in
 *     none: the 2026-10-27 sweep fit all 24 layouts in all six languages. The sweep's
 *     brand is a 2:1 badge; with a squarer logo (1.6:1 or less) it, fr and bg miss the
 *     upright tents in Europe, where the menu greys it and the file refuses it;
 *   - `held`: misses rule F today (it does not fit every layout with one language),
 *     so Share greys it whenever that language is on the print, and the server
 *     refuses it, until a shorter draft passes: fr "How was your visit?" (the
 *     upright Immersive tent in Europe), fr "Got 30 seconds?" (the upright Paper
 *     tent in Europe) and de "Got 30 seconds?" (the upright Paper tent, both
 *     regions).
 */
export type PrintFinalCopyStatus = 'checked' | 'draft' | 'held'

const HELD: Readonly<Partial<Record<GuestLocale, readonly PrintFinalCallToAction[]>>> =
  Object.freeze({
    fr: ['how_was_visit', 'got_30_seconds'],
    de: ['got_30_seconds'],
  })

export function printFinalCopyStatus(
  locale: GuestLocale,
  callToAction: PrintFinalCallToAction,
): PrintFinalCopyStatus {
  if (locale === 'en') return 'checked'
  return HELD[locale]?.includes(callToAction) === true ? 'held' : 'draft'
}

/** The first language on the print whose copy of the wording rule F holds back; null when every one prints. */
export function printFinalHeldLanguage(
  callToAction: PrintFinalCallToAction,
  languages: readonly GuestLocale[],
): GuestLocale | null {
  return (
    languages.find((locale) => printFinalCopyStatus(locale, callToAction) === 'held') ??
    null
  )
}
