// The code block's styles, from the same plan and measures the PDF draws from
// (`portal-print-kit-code-block.ts`, `portal-print-kit-measures.ts`). A pure
// function of the plan, the colours and a length function, so it can be tested
// without a DOM and the component stays a thin tree of elements.
//
// Inline styles on purpose, as the rest of the print preview's: the first-paint
// stylesheet is built by scanning `src/` for class names, and a measure this
// specific would be added to the stylesheet of every page in production.

import type { CSSProperties } from 'react'
import type {
  CodeBlockColours,
  CodeBlockPlan,
} from '#/shared/domain/portal-print-kit-code-block'
import { CODE_BLOCK } from '#/shared/domain/portal-print-kit-measures'
import { PRINT_KIT_TILE } from '#/shared/domain/portal-print-kit-palette'

/** A length in points, as a CSS length: pixels at 96 to the inch, or a share of a card's width. */
export type PointsToLength = (points: number) => string

const CSS_PIXELS_PER_POINT = 96 / 72

/** Points as CSS pixels: 144 pt is the 192 px that 2 in measures on a screen. */
export const pointsToPixels: PointsToLength = (points) =>
  `${Number((points * CSS_PIXELS_PER_POINT).toFixed(4))}px`

export type CodeBlockStyles = Readonly<{
  root: CSSProperties
  code: CSSProperties
  bar: CSSProperties
  icon: CSSProperties
  cues: CSSProperties
  cue: CSSProperties
}>

export function codeBlockStyles(
  plan: CodeBlockPlan,
  colours: CodeBlockColours,
  pt: PointsToLength,
): CodeBlockStyles {
  const { iconAbove } = plan
  return {
    root: {
      flex: 'none',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      width: pt(CODE_BLOCK.tilePt),
      height: pt(plan.heightPt),
      borderRadius: pt(CODE_BLOCK.radiusPt),
      overflow: 'hidden',
      background: PRINT_KIT_TILE,
      // Outside the 2 in, so the bar stays exactly as wide as the print check says.
      boxShadow:
        colours.outline === null
          ? 'none'
          : `0 0 0 ${pt(CODE_BLOCK.outlinePt)} ${colours.outline}`,
      fontFamily: 'var(--font-guest-body)',
    },
    code: {
      display: 'block',
      flex: 'none',
      width: pt(CODE_BLOCK.tilePt),
      height: pt(CODE_BLOCK.tilePt),
    },
    bar: {
      flex: 'none',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: iconAbove ? 'column' : 'row',
      alignItems: 'center',
      // Above the lines, the same space over, between and under the pictogram and the lines.
      justifyContent: iconAbove ? 'space-evenly' : 'center',
      gap: iconAbove ? 0 : pt(CODE_BLOCK.iconGapPt),
      height: pt(plan.barPt),
      padding: `0 ${pt(CODE_BLOCK.barPaddingPt)}`,
      background: colours.barFill,
      color: colours.barText,
    },
    icon: { flex: 'none', width: pt(plan.iconPt), height: pt(plan.iconPt) },
    cues: {
      display: 'flex',
      flexDirection: 'column',
      gap: pt(CODE_BLOCK.cueGapPt),
      minWidth: 0,
    },
    cue: {
      display: 'block',
      fontSize: pt(plan.cuePt),
      fontWeight: 600,
      lineHeight: CODE_BLOCK.cueLeading,
      letterSpacing: `${CODE_BLOCK.cueTrackingEm}em`,
      whiteSpace: 'nowrap',
    },
  }
}
