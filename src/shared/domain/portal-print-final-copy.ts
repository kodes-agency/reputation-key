// What the final kit's call to action says, per language (final design spec
// 2026-10-25 §5.5): the headline and the sub-line under it. Today's kit keeps its
// own table (`PRINT_KIT_COPY`); the final kit reads this one.
//
// The default says "How did we do?" over "About 30 seconds". The owner decided it
// among the recommended options of the call-to-action brainstorm: neutral
// wording, asked of every guest the same way (Google does not allow a card that
// asks only for good reviews, or that discourages bad ones), no stars, and no
// "private" or "privately" in any language (fixed rule NP: on a review card a
// privacy word can read as steering unhappy guests away from Google; the guest
// page itself still says "Send privately").
//
// The presets this slice ships are the two ids the print has stored since the
// first final kit, `rate` and `tell`. `rate` is the DEFAULT slot and now holds
// the spec's `how_did_we_do`; `tell` holds `how_was_visit`. The preset model of
// slice C2 (four ids, `rate_visit` and `got_30_seconds` added, stored rows
// migrated) replaces the two ids; until then a stored `rate` reads "How did we
// do?".
//
// "About 30 seconds" is true only while the guest page really takes about that
// long, from the scan to the end of the rating. If it does not, the sub-line
// becomes "A minute or less" in every language (drafts: es "Un minuto o menos",
// it "Un minuto o meno", fr "Une minute ou moins", de "Eine Minute oder weniger",
// bg "Минута или по-малко"); that is one edit of this table.
//
// Every non-English string is a draft that no native speaker has checked yet, as
// the closed beta allows, and slice C9 (the owner's) is where they are checked:
//   - doubtful drafts (†): fr, de and bg `rate`;
//   - fr `tell` misses rule F (it does not fit every layout with one language,
//     the upright Immersive tent in Europe), which the print refuses rather than
//     letting it overflow (`words_do_not_fit`).
// French takes a no-break space (U+00A0) before "?" so a line never starts with
// it.

import type { GuestLocale } from './guest-locale'
import type { PrintKitCallToAction, PrintKitCopy } from './portal-print-kit'

export const PRINT_FINAL_COPY: Readonly<
  Record<GuestLocale, Readonly<Record<PrintKitCallToAction, PrintKitCopy>>>
> = Object.freeze({
  en: {
    rate: { headline: 'How did we do?', subline: 'About 30 seconds' },
    tell: { headline: 'How was your visit?', subline: 'About 30 seconds' },
  },
  bg: {
    rate: { headline: 'Как беше при нас?', subline: 'Около 30 секунди' },
    tell: { headline: 'Как мина посещението ви?', subline: 'Около 30 секунди' },
  },
  es: {
    rate: { headline: '¿Cómo lo hicimos?', subline: 'Unos 30 segundos' },
    tell: { headline: '¿Qué tal su visita?', subline: 'Unos 30 segundos' },
  },
  it: {
    rate: { headline: 'Come siamo andati?', subline: 'Circa 30 secondi' },
    tell: { headline: 'Com’è andata la sua visita?', subline: 'Circa 30 secondi' },
  },
  fr: {
    rate: { headline: 'Votre avis sur nous ?', subline: 'Environ 30 secondes' },
    tell: {
      headline: 'Comment était votre visite ?',
      subline: 'Environ 30 secondes',
    },
  },
  de: {
    rate: { headline: 'Wie war es bei uns?', subline: 'Etwa 30 Sekunden' },
    tell: { headline: 'Wie war Ihr Besuch?', subline: 'Etwa 30 Sekunden' },
  },
})
