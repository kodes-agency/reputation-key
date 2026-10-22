// One Immersive face, drawn as the PDF draws it (spec 5.2 and 5.3): a counter
// card (4 × 6 in or A6) or a tent panel (4 × 6 in or A6), on the guest page's
// dark field with its two washes. The same flex column the design boards use:
// the brand at the top margin, a fixed gap, the photo window, a flexible gap,
// the words, a flexible gap and the code block at the bottom margin. The window
// grows first, to its cap, and shrinks first, to its floor; the fit step comes
// from `previewImmersiveFit`, as the PDF's comes from measuring.
//
// A tent panel's top margin is measured from its ridge band. With no photo the
// window holds the monogram; a two-language tent panel has no window (D4).
//
// Inline styles in container units, as the rest of the print preview's.

import type { CSSProperties } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { PrintFace } from '#/shared/domain/portal-print-kit'
import { cueLinesFor } from '#/shared/domain/portal-print-kit-code-block'
import {
  WINDOW_FRAME_PT,
  immersiveGridOf,
  isImmersiveGeometry,
  monogramLetter,
  windowPictureRangePt,
  windowWidthPt,
  type ImmersiveGeometry,
} from '#/shared/domain/portal-print-kit-immersive'
import { WINDOW, mmToPt } from '#/shared/domain/portal-print-kit-measures'
import {
  immersivePrintKitPalette,
  type ImmersivePrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import type { PanelGeometry } from '#/shared/domain/portal-print-kit-sheets'
import { PrintKitCodeBlock } from './print-kit-code-block'
import type { PointsToLength } from './print-kit-code-block-layout'
import { PrintKitFaceBrand, brandInkPt } from './print-kit-face-brand-art'
import { PrintKitFaceStack } from './print-kit-face-stack'
import {
  immersiveBackground,
  previewImmersiveFit,
  previewPhotoDim,
} from './print-kit-immersive-art-layout'
import { ptToContainerWidth } from './print-kit-paper-art-layout'

type Props = Readonly<{
  geometry: PanelGeometry
  face: PrintFace
  look: PortalPrintKitView['look']
  codeUrl: string | null
  /** No ground and no ridge band: the sheet paints them into the bleed. */
  bare: boolean
  pt: PointsToLength
}>

/** The ridge band's hairline, on its outer edge. */
const RIDGE_HAIRLINE_PT = mmToPt(0.3)

/** A flexible gap: it takes an equal share of what the window leaves, never less than `min`. */
const Gap = ({ min, pt }: Readonly<{ min: number; pt: PointsToLength }>) => (
  <div aria-hidden style={{ flex: '1 1 0', minHeight: pt(min) }} />
)

function Monogram({
  geometry,
  letter,
  palette,
}: Readonly<{
  geometry: ImmersiveGeometry
  letter: string
  palette: ImmersivePrintKitPalette
}>) {
  // The picture is a size container, so its own lengths are in its own width,
  // and the letter is 74% of its height whatever the fit made it.
  const pictureWidth = windowWidthPt(geometry) - 2 * WINDOW_FRAME_PT
  const pp = (points: number) => ptToContainerWidth(points, pictureWidth)
  const { monogram } = WINDOW
  const rule: CSSProperties = {
    flex: 'none',
    width: pp(monogram.ruleLengthPt),
    height: pp(monogram.ruleWeightPt),
    background: palette.monoLine,
  }
  return (
    <div
      style={{
        height: '100%',
        background: palette.plateTone,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: pp(monogram.gapPt),
      }}
    >
      <span style={rule} />
      {letter !== '' && (
        <span
          style={{
            fontFamily: 'var(--font-guest-display)',
            fontWeight: 600,
            fontSize: `${monogram.letterShare * 100}cqh`,
            lineHeight: 1,
            color: palette.mono,
            transform: 'translateY(4%)',
          }}
        >
          {letter}
        </span>
      )}
      <span style={rule} />
    </div>
  )
}

function Window({
  geometry,
  look,
  palette,
  pt,
}: Readonly<{
  geometry: ImmersiveGeometry
  look: PortalPrintKitView['look']
  palette: ImmersivePrintKitPalette
  pt: PointsToLength
}>) {
  const range = windowPictureRangePt(geometry)
  const { frame } = WINDOW
  const focal = look.heroFocal ?? { x: 0.5, y: 0.5 }
  return (
    <div
      aria-hidden
      data-print-window
      style={{
        flex: '1000 1 0',
        alignSelf: 'stretch',
        minHeight: pt(range.minPt + 2 * WINDOW_FRAME_PT),
        maxHeight: pt(range.maxPt + 2 * WINDOW_FRAME_PT),
        boxSizing: 'border-box',
        padding: pt(frame.paddingPt),
        border: `${pt(frame.borderPt)} solid ${palette.accentLine}`,
        borderRadius: pt(frame.outerRadiusPt),
      }}
    >
      <div
        style={{
          position: 'relative',
          height: '100%',
          borderRadius: pt(frame.innerRadiusPt),
          overflow: 'hidden',
          containerType: 'size',
        }}
      >
        {look.heroUrl === null ? (
          <Monogram
            geometry={geometry}
            letter={monogramLetter(look.wordmark)}
            palette={palette}
          />
        ) : (
          <>
            <img
              src={look.heroUrl}
              alt=""
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: `${focal.x * 100}% ${focal.y * 100}%`,
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: previewPhotoDim(palette),
              }}
            />
          </>
        )}
      </div>
    </div>
  )
}

export function PrintKitImmersiveFace({
  geometry,
  face,
  look,
  codeUrl,
  bare,
  pt,
}: Props) {
  if (!isImmersiveGeometry(geometry)) return null
  const grid = immersiveGridOf(geometry)
  const palette = immersivePrintKitPalette(look.accentColour, look.fieldColour)
  const fit = previewImmersiveFit(face, geometry, look)
  const ridge = grid.ridgePt ?? 0
  const top = ridge + grid.marginPt - brandInkPt(look, fit.wordmarkPt)
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        padding: `${pt(top)} ${pt(grid.sidePt)} ${pt(grid.marginPt)}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        overflow: 'hidden',
        background: bare ? 'transparent' : immersiveBackground(palette),
        fontFamily: 'var(--font-guest-body)',
        fontSize: pt(10),
      }}
    >
      {grid.ridgePt !== null && !bare && (
        <div
          aria-hidden
          data-print-ridge
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            right: 0,
            height: pt(grid.ridgePt),
            boxSizing: 'border-box',
            background: palette.lift,
            borderBottom: `${pt(RIDGE_HAIRLINE_PT)} solid ${palette.accentLine}`,
          }}
        />
      )}
      <PrintKitFaceBrand
        look={look}
        colour={palette.headline}
        wordmarkPt={fit.wordmarkPt}
        logoHeightPt={fit.logoHeightPt}
        align="centre"
        pt={pt}
      />
      {fit.window && <div aria-hidden style={{ flex: 'none', height: pt(fit.gapPt) }} />}
      {fit.window && <Window geometry={geometry} look={look} palette={palette} pt={pt} />}
      <Gap min={fit.gapPt} pt={pt} />
      <PrintKitFaceStack
        face={face}
        scale={fit.scale}
        align="centre"
        colours={{
          ink: palette.headline,
          soft: palette.body,
          accentInk: palette.accentInk,
          rule: palette.accentLine,
        }}
        placeToHeadPt={fit.placeToHeadPt}
        pt={pt}
      />
      <Gap min={fit.gapPt} pt={pt} />
      <PrintKitCodeBlock
        palette={palette}
        cues={cueLinesFor(face.blocks.map((block) => block.locale))}
        codeUrl={codeUrl}
        pt={pt}
      />
    </div>
  )
}
