// The final code block in the Share tab's preview (final design spec §5.2), as
// the PDF draws it: the cream tile with the code and its quiet zone, the accent
// bar joined under it with the cue in each language and no icon, corners
// rounded at 5 % of the tile, and on Paper the accent-ink outline outside the
// cream square and the bar. A browser snaps the 0.35 mm border to device
// pixels; the file draws it at 0.35 mm.

import type { PrintFinalFaceLayout } from '#/shared/domain/portal-print-final-face'
import { PRINT_FINAL_MEASURES, mmPt } from '#/shared/domain/portal-print-final-measures'
import { PRINT_FINAL_TYPE_SETTINGS } from '#/shared/domain/portal-print-final-type'
import {
  PRINT_KIT_TILE,
  type PaperPrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import type { PointsToLength } from './print-kit-code-block-layout'

type Props = Readonly<{
  layout: PrintFinalFaceLayout
  palette: PaperPrintKitPalette
  codeUrl: string | null
  pt: PointsToLength
}>

export function PrintFinalCodeArt({ layout, palette, codeUrl, pt }: Props) {
  const { code, cues, plan } = layout
  const box = plan.code
  const cuePt = PRINT_FINAL_MEASURES[plan.face.region][plan.face.piece].cuePt
  const { leading, lineGapMm } = PRINT_FINAL_TYPE_SETTINGS.cue
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
        border: `${pt(code.outlinePt)} solid ${palette.accentInk}`,
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
          height: pt(code.barPt),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: pt(mmPt(lineGapMm)),
          background: palette.barFill,
          color: palette.barText,
        }}
      >
        {cues.map((cue) => (
          <span
            key={`${cue.locale}:${cue.text}`}
            lang={cue.locale}
            style={{
              display: 'block',
              fontFamily: 'var(--font-guest-body)',
              fontWeight: 600,
              fontSize: pt(cuePt),
              lineHeight: pt(cuePt * leading),
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
