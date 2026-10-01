// The colours of one print, from the property's look.
//
// The field is the guest page's own dark field, so light text clears AAA on it
// whatever the accent (portal-field-colour.ts). The accent is used for text only
// where it reads on the field, and the two washes are the guest backdrop's, so a
// printed card and the page it opens look like one thing.

import {
  IMMERSIVE_TEXT_COLOUR,
  deriveBackdropTones,
  isAccentReadableOnField,
} from '#/shared/domain/portal-field-colour'

export type PrintKitPalette = Readonly<{
  field: string
  headline: string
  body: string
  /** The small line above the call to action. */
  kicker: string
  /** The washes painted over the field. */
  warm: string
  cool: string
  /** The code and the paper under it: fixed, so any phone reads it. */
  plateInk: string
  platePaper: string
}>

export function printKitPalette(accent: string, field: string): PrintKitPalette {
  const tones = deriveBackdropTones(accent, field)
  return {
    field,
    headline: '#FFFFFF',
    body: IMMERSIVE_TEXT_COLOUR,
    kicker: isAccentReadableOnField(accent, field) ? accent : IMMERSIVE_TEXT_COLOUR,
    warm: tones?.warm ?? field,
    cool: tones?.cool ?? field,
    plateInk: '#121614',
    platePaper: '#F6F1E6',
  }
}
