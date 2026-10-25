// A print shop's file as the Share tab's preview draws it (final design spec
// §10.3, the board print-shop), from the page the PDF draws (`printFinalShopPage`):
// the page, white; the card at its trim with an Immersive card's photo and
// ground run into the print margin (a Paper card's margin stays white); the crop
// marks in black where they are on; and a dashed line where the card is cut. A
// card's back is the next page, in the same place.
//
// Laid out in container units of the page's width; the face is laid out once
// (`usePrintFinalDrawnFace`) with the page's margin as its bleed. Inline styles,
// as the rest of the preview.

import { useMemo } from 'react'
import type { PrintFinalFraming } from '#/shared/domain/portal-print-final-framing'
import {
  printFinalShopFaceBleed,
  PRINT_FINAL_SHOP_MARK_COLOUR,
  PRINT_FINAL_SHOP_MARK_WEIGHT_PT,
  PRINT_FINAL_SHOP_PAGE_COLOUR,
  type PrintFinalShopPage,
} from '#/shared/domain/portal-print-final-shop'
import { ptToContainerWidth } from './print-kit-paper-art-layout'
import { PrintFinalDrawnBackArt } from './print-final-back-art'
import { PrintFinalDrawnFaceArt } from './print-final-face-art'
import { usePrintFinalDrawnBack } from './use-print-final-drawn-back'
import {
  usePrintFinalDrawnFace,
  type PrintFinalFaceInput,
} from './use-print-final-drawn-face'

/**
 * Where the card is cut, drawn as a guide the file does not print: a dashed line
 * that inverts what is under it, so it reads on the white page, the cream paper
 * and a dark photo alike.
 */
const TRIM_GUIDE = { border: '1px dashed white', mixBlendMode: 'difference' } as const

type Props = Readonly<{
  page: PrintFinalShopPage
  /** The face on the page; the page gives it its margin as bleed. */
  face: Omit<PrintFinalFaceInput, 'bleed'>
  codeUrl: string | null
  framing?: PrintFinalFraming
  /** Show the back page instead of the front. */
  back?: boolean
  /** What the picture is, for a screen reader: "Print-shop file, page 1 of 1". */
  label: string
}>

/** The crop marks as the file draws them: black lines of their weight, outside the card's margin. */
function CropMarks({ page }: Readonly<{ page: PrintFinalShopPage }>) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${page.widthPt} ${page.heightPt}`}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    >
      <g
        stroke={PRINT_FINAL_SHOP_MARK_COLOUR}
        strokeWidth={PRINT_FINAL_SHOP_MARK_WEIGHT_PT}
      >
        {page.marks.map((mark) => (
          <line
            key={`${mark.x0Pt}:${mark.y0Pt}:${mark.x1Pt}:${mark.y1Pt}`}
            x1={mark.x0Pt}
            y1={mark.y0Pt}
            x2={mark.x1Pt}
            y2={mark.y1Pt}
          />
        ))}
      </g>
    </svg>
  )
}

export function PrintFinalShopArt({
  page,
  face,
  codeUrl,
  framing,
  back = false,
  label,
}: Props) {
  // Held per page: a new bleed would lay the Immersive face out again on every render.
  const immersive = page.face.look === 'immersive'
  const bleed = useMemo(
    () => (immersive ? printFinalShopFaceBleed(page) : undefined),
    [immersive, page],
  )
  const drawn = usePrintFinalDrawnFace({ ...face, bleed })
  const drawnBack = usePrintFinalDrawnBack({
    face: face.face,
    look: face.look,
    front: drawn,
    enabled: back,
    bleed,
  })
  const u = (points: number) => ptToContainerWidth(points, page.widthPt)
  const { trim } = page
  return (
    <div
      role="img"
      aria-label={label}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${page.widthPt} / ${page.heightPt}`,
        containerType: 'inline-size',
        overflow: 'hidden',
        background: PRINT_FINAL_SHOP_PAGE_COLOUR,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: u(trim.leftPt),
          top: u(trim.topPt),
          width: u(trim.widthPt),
          height: u(trim.heightPt),
        }}
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
      </div>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: u(trim.leftPt),
          top: u(trim.topPt),
          width: u(trim.widthPt),
          height: u(trim.heightPt),
          boxSizing: 'border-box',
          ...TRIM_GUIDE,
        }}
      />
      {page.cropMarks && <CropMarks page={page} />}
    </div>
  )
}
