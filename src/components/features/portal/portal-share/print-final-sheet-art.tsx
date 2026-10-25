// The first office sheet of a final print in the Share tab's preview (final
// design spec §10.1 and §10.2), from the geometry the PDF draws: the paper,
// turned to landscape where the piece turns it, the face in each cell the first
// sheet fills (a card upright or a quarter turn across its cell, a tent flat with
// its back face upside down above the fold), each Immersive face run into its
// bleed, then the sheet's marks and its printed note. So the sheet a manager sees
// is the sheet the file prints. Its reverse (`back`) shows each filled cell's back
// in the cell behind it, the cells mirrored, with no marks and no note.
//
// Laid out in container units of the sheet's width; every face is the same face,
// laid out once (`usePrintFinalDrawnFace`) and drawn in each cell. Inline styles,
// as the rest of the preview.

import { useMemo, type ReactNode } from 'react'
import type { PrintFinalFraming } from '#/shared/domain/portal-print-final-framing'
import {
  PRINT_FINAL_SHEET_MARKS,
  printFinalMarkColour,
  printFinalSheetMarks,
  type PrintFinalSheetMark,
} from '#/shared/domain/portal-print-final-sheet-marks'
import {
  PRINT_FINAL_SHEET_NOTE,
  printFinalSheetNotes,
} from '#/shared/domain/portal-print-final-sheet-notes'
import { printFinalBackPlacement } from '#/shared/domain/portal-print-final-back-sheets'
import {
  printFinalCellPlacements,
  type PrintFinalSheet,
  type PrintFinalSheetPlacement,
} from '#/shared/domain/portal-print-final-sheets'
import { printFinalSheetFaceBleed } from '#/shared/domain/portal-print-final-immersive-sheets'
import { printFinalLiveArea } from '#/shared/domain/portal-print-final-measures'
import { PRINT_KIT_PAPER } from '#/shared/domain/portal-print-kit-palette'
import { ptToContainerWidth } from './print-kit-paper-art-layout'
import { PrintFinalDrawnBackArt } from './print-final-back-art'
import { PrintFinalDrawnFaceArt } from './print-final-face-art'
import { usePrintFinalDrawnPiece } from './use-print-final-drawn-piece'
import type { PrintFinalFaceInput } from './use-print-final-drawn-face'

type Props = Readonly<{
  sheet: PrintFinalSheet
  /** How many pieces the first sheet holds, from its first cell. */
  filled: number
  /** The face every cell holds; the sheet gives it its bleed. */
  face: Omit<PrintFinalFaceInput, 'bleed'>
  codeUrl: string | null
  framing?: PrintFinalFraming
  /** The code's cream square, which the printed note names. */
  tilePt: number
  /** What the picture is, for a screen reader: "Letter landscape · sheet 1 of 5". */
  label: string
  /** Show the sheet's reverse: the backs of a card's back page, in mirrored cells. Absent: the front. */
  back?: boolean
}>

/** One face in its place on the sheet: its own size, centred in its box and turned to fill it. */
function Placed({
  placement,
  widthPt,
  heightPt,
  u,
  children,
}: Readonly<{
  placement: PrintFinalSheetPlacement
  widthPt: number
  heightPt: number
  u: (points: number) => string
  children: ReactNode
}>) {
  const centreX = placement.leftPt + placement.widthPt / 2
  const centreY = placement.topPt + placement.heightPt / 2
  return (
    <div
      style={{
        position: 'absolute',
        left: u(centreX - widthPt / 2),
        top: u(centreY - heightPt / 2),
        width: u(widthPt),
        height: u(heightPt),
        transform:
          placement.turnDeg === 0 ? undefined : `rotate(${placement.turnDeg}deg)`,
      }}
    >
      {children}
    </div>
  )
}

/** The marks as the file draws them: ticks as lines of their weight, fold marks dashed. */
function Marks({
  sheet,
  marks,
}: Readonly<{ sheet: PrintFinalSheet; marks: readonly PrintFinalSheetMark[] }>) {
  const { tickWeightPt, foldWeightPt, foldDashPt } = PRINT_FINAL_SHEET_MARKS
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${sheet.widthPt} ${sheet.heightPt}`}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    >
      <g stroke={printFinalMarkColour(sheet.look)} fill="none">
        {marks.map((mark) => (
          <line
            key={`${mark.kind}:${mark.x0Pt}:${mark.y0Pt}:${mark.x1Pt}:${mark.y1Pt}`}
            x1={mark.x0Pt}
            y1={mark.y0Pt}
            x2={mark.x1Pt}
            y2={mark.y1Pt}
            strokeWidth={mark.kind === 'fold' ? foldWeightPt : tickWeightPt}
            strokeDasharray={
              mark.kind === 'fold' ? `${foldDashPt} ${foldDashPt}` : undefined
            }
          />
        ))}
      </g>
    </svg>
  )
}

export function PrintFinalSheetArt({
  sheet,
  filled,
  face,
  codeUrl,
  framing,
  tilePt,
  label,
  back = false,
}: Props) {
  // Held per sheet: a new bleed would lay the Immersive face out again on every render.
  const { piece, bleedPt } = sheet
  const immersive = sheet.look === 'immersive'
  const bleed = useMemo(
    () => (immersive ? printFinalSheetFaceBleed({ piece, bleedPt }) : undefined),
    [immersive, piece, bleedPt],
  )
  const { drawn, drawnBack } = usePrintFinalDrawnPiece({ face, bleed, back })
  const u = (points: number) => ptToContainerWidth(points, sheet.widthPt)
  const cells = sheet.cells.slice(0, filled)
  const { widthPt, heightPt } = printFinalLiveArea(face.face)
  return (
    <div
      role="img"
      aria-label={label}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${sheet.widthPt} / ${sheet.heightPt}`,
        containerType: 'inline-size',
        overflow: 'hidden',
        background: PRINT_KIT_PAPER,
      }}
    >
      {cells.flatMap((cell) =>
        (drawnBack === null
          ? printFinalCellPlacements(sheet, cell)
          : [printFinalBackPlacement(sheet, cell)]
        ).map((placement) => (
          <Placed
            key={`${placement.leftPt}:${placement.topPt}`}
            placement={placement}
            widthPt={widthPt}
            heightPt={heightPt}
            u={u}
          >
            {drawnBack === null ? (
              <PrintFinalDrawnFaceArt
                drawn={drawn}
                look={face.look}
                codeUrl={codeUrl}
                framing={framing}
                bleed={bleed}
                pt={u}
              />
            ) : (
              <PrintFinalDrawnBackArt
                drawn={drawnBack}
                look={face.look}
                bleed={bleed}
                pt={u}
              />
            )}
          </Placed>
        )),
      )}
      {drawnBack === null && (
        <Marks sheet={sheet} marks={printFinalSheetMarks(sheet, cells)} />
      )}
      {(drawnBack === null ? printFinalSheetNotes(sheet, tilePt, cells) : []).map(
        (note) => (
          <p
            key={`${note.leftPt}:${note.topPt}`}
            aria-hidden
            style={{
              position: 'absolute',
              margin: 0,
              left: u(note.leftPt),
              top: u(note.topPt),
              width: u(note.widthPt),
              fontFamily: 'var(--font-guest-body)',
              fontWeight: 400,
              fontSize: u(PRINT_FINAL_SHEET_NOTE.sizePt),
              lineHeight: PRINT_FINAL_SHEET_NOTE.leading,
              color: PRINT_FINAL_SHEET_NOTE.colour,
            }}
          >
            {note.text}
          </p>
        ),
      )}
    </div>
  )
}
