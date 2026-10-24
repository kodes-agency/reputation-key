// The colour of each part of a card's words (round-2 spec-delta R2): on
// Immersive white and the guest page's body on the field, the eyebrow in the
// lightened accent; on Paper ink and soft on the paper, the eyebrow in the
// darkened accent. The PDF and the Share tab's preview both read it.

import type { CardTextRole } from './portal-print-kit-card-words'
import type { PrintKitPalette } from './portal-print-kit-palette'

/** The colour of each role, and of the rule between two languages. */
export type CardColours = Readonly<Record<CardTextRole | 'rule', string>>

export function cardColours(palette: PrintKitPalette): CardColours {
  if (palette.style === 'immersive') {
    return {
      wordmark: palette.headline,
      name: palette.body,
      eyebrow: palette.accentInk,
      cta: palette.headline,
      sub: palette.body,
      cta2: palette.headline,
      rule: palette.accentLine,
    }
  }
  return {
    wordmark: palette.ink,
    name: palette.ink,
    eyebrow: palette.accentInk,
    cta: palette.ink,
    sub: palette.soft,
    cta2: palette.ink,
    rule: palette.accentInk,
  }
}
