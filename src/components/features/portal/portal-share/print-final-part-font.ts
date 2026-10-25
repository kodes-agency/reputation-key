// How a part of a final face's words is set in the Share tab's preview: the
// guest fonts, the size and leading, the tracking, and the two OpenType choices
// the file makes too. Cormorant Garamond's figures are old-style by default, so
// "30" would read as "3o": the display face asks for lining figures, as the file
// does with its `lnum` feature (final design spec §3). A tracked line is set
// letter by letter in the file, so no ligature joins a TT. Inline styles on
// purpose, as the rest of the print preview's.

import type { CSSProperties } from 'react'
import type { PrintFinalTextStyle } from '#/shared/domain/portal-print-final-text'
import type { PointsToLength } from './print-kit-code-block-layout'

export function previewFinalFont(
  style: PrintFinalTextStyle,
  pt: PointsToLength,
): CSSProperties {
  return {
    fontFamily:
      style.family === 'serif' ? 'var(--font-guest-display)' : 'var(--font-guest-body)',
    fontWeight: style.weight,
    fontStyle: style.italic ? 'italic' : 'normal',
    fontSize: pt(style.sizePt),
    lineHeight: pt(style.sizePt * style.leading),
    letterSpacing: `${style.trackingEm}em`,
    fontVariantLigatures: style.trackingEm > 0 ? 'none' : 'normal',
    ...(style.family === 'serif' ? { fontVariantNumeric: 'lining-nums' } : {}),
  }
}
