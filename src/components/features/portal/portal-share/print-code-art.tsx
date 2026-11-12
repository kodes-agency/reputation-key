// The code block in the Share tab's preview (design spec §5.2), as
// the PDF draws it: the cream tile with the code and its quiet zone, the accent
// bar joined under it with the cue in each language and no icon, corners
// rounded at 5 % of the tile, and on Paper the accent-ink outline outside the
// cream square and the bar (Immersive has none). A browser snaps the 0.35 mm
// border to device pixels; the file draws it at 0.35 mm. The cue lines sit where
// the layout put their baselines: centred in the bar by their ink, as the file
// draws them.

import type { PrintFaceLayout } from '#/shared/domain/portal-print-face'
import { printCueStyle } from '#/shared/domain/portal-print-cue'
import { PRINT_MEASURES } from '#/shared/domain/portal-print-measures'
import type { PrintColours } from '#/shared/domain/portal-print-colours'
import { PRINT_KIT_TILE } from '#/shared/domain/portal-print-kit-palette'
import { previewLineTopPt } from './print-face-layout'
import type { PointsToLength } from './print-kit-code-block-layout'

type Props = Readonly<{
  layout: PrintFaceLayout
  colours: PrintColours
  codeUrl: string | null
  pt: PointsToLength
}>

export function PrintCodeArt({ layout, colours, codeUrl, pt }: Props) {
  const { code, cues, plan } = layout
  const box = plan.code
  const cuePt = PRINT_MEASURES[plan.face.region][plan.face.piece].cuePt
  const cueStyle = printCueStyle(cuePt)
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
