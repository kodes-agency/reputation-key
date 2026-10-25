// The final code block in the Share tab's preview (final design spec §5.2), as
// the PDF draws it: the cream tile with the code and its quiet zone, the accent
// bar joined under it with the cue in each language and no icon, corners
// rounded at 5 % of the tile, and on Paper the accent-ink outline outside the
// cream square and the bar (Immersive has none). A browser snaps the 0.35 mm
// border to device pixels; the file draws it at 0.35 mm. The cue lines sit where
// the layout put their baselines: centred in the bar by their ink, as the file
// draws them.

import type { PrintFinalFaceLayout } from '#/shared/domain/portal-print-final-face'
import { printFinalCueStyle } from '#/shared/domain/portal-print-final-cue'
import { PRINT_FINAL_MEASURES } from '#/shared/domain/portal-print-final-measures'
import type { PrintFinalColours } from '#/shared/domain/portal-print-final-colours'
import { PRINT_KIT_TILE } from '#/shared/domain/portal-print-kit-palette'
import { previewLineTopPt } from './print-final-face-layout'
import type { PointsToLength } from './print-kit-code-block-layout'

type Props = Readonly<{
  layout: PrintFinalFaceLayout
  colours: PrintFinalColours
  codeUrl: string | null
  pt: PointsToLength
}>

export function PrintFinalCodeArt({ layout, colours, codeUrl, pt }: Props) {
  const { code, cues, plan } = layout
  const box = plan.code
  const cuePt = PRINT_FINAL_MEASURES[plan.face.region][plan.face.piece].cuePt
  const cueStyle = printFinalCueStyle(cuePt)
  return (
    <div
      aria-hidden
      data-print-code
      style={{
        position: 'absolute',
        left: pt(box.leftPt),
        top: pt(box.topPt),
        width: pt(code.widthPt),
        height: pt(code.heightPt),
        boxSizing: 'border-box',
        border:
          colours.outline === null
            ? 'none'
            : `${pt(code.outlinePt)} solid ${colours.outline}`,
        borderRadius: pt(code.radiusPt),
        overflow: 'hidden',
        background: PRINT_KIT_TILE,
      }}
    >
      {codeUrl === null ? (
        <div style={{ width: pt(code.tilePt), height: pt(code.tilePt) }} />
      ) : (
        <img
          src={codeUrl}
          alt=""
          style={{ display: 'block', width: pt(code.tilePt), height: pt(code.tilePt) }}
        />
      )}
      <div
        style={{
          position: 'relative',
          height: pt(code.barPt),
          background: colours.barFill,
          color: colours.barText,
        }}
      >
        {cues.map((cue) => (
          <span
            key={`${cue.locale}:${cue.text}`}
            lang={cue.locale}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: pt(previewLineTopPt(cueStyle, cue.baselinePt)),
              textAlign: 'center',
              fontFamily: 'var(--font-guest-body)',
              fontWeight: 600,
              fontSize: pt(cuePt),
              lineHeight: pt(cuePt * cueStyle.leading),
              whiteSpace: 'nowrap',
            }}
          >
            {cue.text}
          </span>
        ))}
      </div>
    </div>
  )
}
