// The whole sheet a Paper print comes out of the printer as (spec 4.3 and 4.4),
// composed from the same pages the PDF draws (`printKitPages`): each face in its
// slot, turned upside down above a tent's fold, the grey ticks where the sheet
// is cut or folded, and on the Letter card sheet the print check in the strip
// that is cut away. So the Whole sheet view cannot show a sheet the file does not
// print.
//
// Laid out in container units of the sheet's width; the faces in their slots
// lay themselves out in their own. Inline styles, as the rest of the preview.

import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type {
  PrintFace,
  PrintKitPaper,
  PrintKitPiece,
} from '#/shared/domain/portal-print-kit'
import { CODE_BLOCK } from '#/shared/domain/portal-print-kit-measures'
import {
  PRINT_KIT_PAPER,
  paperPrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import {
  PANEL_SIZE_PT,
  PRINT_CHECK,
  TICK,
  printKitPages,
} from '#/shared/domain/portal-print-kit-sheets'
import type { PointsToLength } from './print-kit-code-block-layout'
import { PrintKitFaceArt } from './print-kit-face-art'
import { printKitSheetLabel, ptToContainerWidth } from './print-kit-paper-art-layout'

type Props = Readonly<{
  piece: PrintKitPiece
  paper: PrintKitPaper
  /** The piece's faces (`printKitFaces`): a card's back is on the second page. */
  faces: readonly PrintFace[]
  look: PortalPrintKitView['look']
  codeUrl: string | null
  /** Which page of the print: 0 for the fronts, 1 for a card's backs. */
  page?: number
}>

function PrintCheck({ accent, u }: Readonly<{ accent: string; u: PointsToLength }>) {
  const palette = paperPrintKitPalette(accent)
  const { title, bar, lines } = PRINT_CHECK
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: u(PRINT_CHECK.centreXPt - PRINT_CHECK.widthPt / 2),
        top: u(PRINT_CHECK.topPt),
        width: u(PRINT_CHECK.widthPt),
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: u(PRINT_CHECK.gapPt),
        textAlign: 'center',
        color: palette.soft,
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: u(title.sizePt),
          fontWeight: 600,
          lineHeight: title.leading,
          color: palette.ink,
        }}
      >
        {title.text}
      </p>
      <div
        style={{
          width: u(bar.widthPt),
          height: u(bar.heightPt),
          background: palette.barFill,
          // Outside the bar, so the bar itself measures the 2 in.
          boxShadow: `0 0 0 ${u(CODE_BLOCK.outlinePt)} ${palette.accentInk}`,
        }}
      />
      <p style={{ margin: 0, fontSize: u(lines.sizePt), lineHeight: lines.leading }}>
        {lines.text.map((line) => (
          <span key={line} style={{ display: 'block' }}>
            {line}
          </span>
        ))}
      </p>
    </div>
  )
}

export function PrintKitSheetArt({
  piece,
  paper,
  faces,
  look,
  codeUrl,
  page = 0,
}: Props) {
  const pages = printKitPages(piece, faces.length, 'paper', paper)
  const index = Math.min(Math.max(0, page), pages.length - 1)
  const sheet = pages[index]
  if (sheet === undefined) return null
  const u: PointsToLength = (points) => ptToContainerWidth(points, sheet.widthPt)
  return (
    <div
      role="img"
      aria-label={printKitSheetLabel(piece, paper, {
        index,
        count: pages.length,
        faces: sheet.panels.length,
      })}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${sheet.widthPt} / ${sheet.heightPt}`,
        containerType: 'inline-size',
        overflow: 'hidden',
        background: PRINT_KIT_PAPER,
        fontFamily: 'var(--font-guest-body)',
      }}
    >
      {sheet.panels.map((panel) => {
        const face = faces.find((candidate) => candidate.side === panel.side)
        if (face === undefined) return null
        return (
          <div
            key={`${panel.leftPt}:${panel.topPt}`}
            data-panel={panel.geometry}
            style={{
              position: 'absolute',
              left: u(panel.leftPt),
              top: u(panel.topPt),
              width: u(PANEL_SIZE_PT[panel.geometry].widthPt),
              transform: panel.rotated ? 'rotate(180deg)' : undefined,
            }}
          >
            <PrintKitFaceArt
              style="paper"
              geometry={panel.geometry}
              face={face}
              look={look}
              codeUrl={codeUrl}
            />
          </div>
        )
      })}
      {sheet.ticks.map((tick) => (
        <span
          key={`${tick.xPt}:${tick.yPt}`}
          aria-hidden
          data-tick
          style={{
            position: 'absolute',
            left: u(tick.xPt),
            top: u(tick.yPt),
            width: u(tick.widthPt),
            height: u(tick.heightPt),
            background: TICK.colour,
          }}
        />
      ))}
      {sheet.printCheck && <PrintCheck accent={look.accentColour} u={u} />}
    </div>
  )
}
