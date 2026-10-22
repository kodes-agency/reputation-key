// What a print-shop page carries round its Immersive faces, as the PDF draws it
// (spec 5.3): the field and washes run into the bleed behind each face, the
// ridge band across the full bleed at a tent's fold, the crop marks outside the
// bleed, dashed fold marks in the side slugs, and the slug line naming the piece.
// The marks come from `printShopMarks`, which the PDF draws from too.
//
// Laid out in the sheet's container units (`u`), as the sheet is.

import type { CSSProperties } from 'react'
import type {
  PrintFace,
  PrintKitPaper,
  PrintKitPiece,
} from '#/shared/domain/portal-print-kit'
import {
  PRINT_SHOP_MARK,
  printShopMarks,
  printShopSlugLines,
  type MarkLine,
} from '#/shared/domain/portal-print-kit-immersive'
import { IMMERSIVE_TENT_GRID, mmToPt } from '#/shared/domain/portal-print-kit-measures'
import {
  PRINT_KIT_INK,
  type ImmersivePrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import { PANEL_SIZE_PT, type PrintKitPage } from '#/shared/domain/portal-print-kit-sheets'
import type { PointsToLength } from './print-kit-code-block-layout'
import { immersiveBackground } from './print-kit-immersive-art-layout'

/** The marks' ink on screen: the board's near-black (the PDF prints them in registration). */
const MARK_INK = PRINT_KIT_INK
const RIDGE_HAIRLINE_PT = mmToPt(0.3)
/** The slug's average advance, in ems, erring wide: the preview cannot measure its font. */
const SLUG_ADVANCE_EM = 0.5

/** The field behind each face, run into the bleed on every side but a tent's fold. */
export function PrintShopGrounds({
  page,
  palette,
  u,
}: Readonly<{
  page: PrintKitPage
  palette: ImmersivePrintKitPalette
  u: PointsToLength
}>) {
  const bleed = page.bleedPt
  const top = page.foldAtPt === null ? bleed : 0
  const ridge =
    page.panels[0]?.geometry === 'tentPanelA6'
      ? IMMERSIVE_TENT_GRID.a4.ridgePt
      : IMMERSIVE_TENT_GRID.letter.ridgePt
  return (
    <>
      {page.panels.map((panel) => {
        const { widthPt, heightPt } = PANEL_SIZE_PT[panel.geometry]
        return (
          <div
            key={`${panel.leftPt}:${panel.topPt}`}
            aria-hidden
            style={{
              position: 'absolute',
              left: u(panel.leftPt),
              top: u(panel.topPt),
              width: u(widthPt),
              height: u(heightPt),
              transform: panel.rotated ? 'rotate(180deg)' : undefined,
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: u(-bleed),
                top: u(-top),
                width: u(widthPt + 2 * bleed),
                height: u(heightPt + top + bleed),
                background: immersiveBackground(palette),
              }}
            />
          </div>
        )
      })}
      {page.foldAtPt !== null && (
        <div
          aria-hidden
          data-print-ridge
          style={{
            position: 'absolute',
            left: u(page.trim.leftPt - bleed),
            top: u(page.foldAtPt - ridge),
            width: u(page.trim.widthPt + 2 * bleed),
            height: u(2 * ridge),
            boxSizing: 'border-box',
            background: palette.lift,
            borderTop: `${u(RIDGE_HAIRLINE_PT)} solid ${palette.accentLine}`,
            borderBottom: `${u(RIDGE_HAIRLINE_PT)} solid ${palette.accentLine}`,
          }}
        />
      )}
    </>
  )
}

function lineStyle(line: MarkLine, u: PointsToLength, dashed: boolean): CSSProperties {
  const weight = PRINT_SHOP_MARK.weightPt
  const across = line.y1 === line.y2
  const left = Math.min(line.x1, line.x2)
  const top = Math.min(line.y1, line.y2)
  const length = across ? Math.abs(line.x2 - line.x1) : Math.abs(line.y2 - line.y1)
  const box: CSSProperties = across
    ? { left: u(left), top: u(top - weight / 2), width: u(length), height: u(weight) }
    : { left: u(left - weight / 2), top: u(top), width: u(weight), height: u(length) }
  return {
    position: 'absolute',
    ...box,
    ...(dashed
      ? { height: 0, borderTop: `${u(weight)} dashed ${MARK_INK}` }
      : { background: MARK_INK }),
  }
}

/** The crop marks, the fold marks and the slug line of a print-shop page. */
export function PrintShopMarks({
  page,
  piece,
  paper,
  faces,
  wordmark,
  u,
}: Readonly<{
  page: PrintKitPage
  piece: PrintKitPiece
  paper: PrintKitPaper
  faces: readonly PrintFace[]
  wordmark: string
  u: PointsToLength
}>) {
  const marks = printShopMarks(page, paper)
  const { slug } = PRINT_SHOP_MARK
  const side =
    piece === 'counter_card' && faces.length > 1 ? (page.panels[0]?.side ?? null) : null
  const lines = printShopSlugLines(piece, paper, {
    brand: wordmark,
    place: faces[0]?.blocks[0]?.kicker ?? '',
    side,
  })
  const text = lines.find(
    (line) => [...line].length * slug.sizePt * SLUG_ADVANCE_EM <= marks.slug.widthPt,
  )
  return (
    <>
      {marks.crop.map((line) => (
        <span
          key={`${line.x1}:${line.y1}:${line.x2}`}
          aria-hidden
          data-crop-mark
          style={lineStyle(line, u, false)}
        />
      ))}
      {marks.fold.map((line) => (
        <span
          key={`${line.x1}:${line.y1}`}
          aria-hidden
          data-fold-mark
          style={lineStyle(line, u, true)}
        />
      ))}
      {text !== undefined && (
        <p
          style={{
            position: 'absolute',
            left: u(marks.slug.centreXPt - marks.slug.widthPt / 2),
            top: u(marks.slug.topPt),
            width: u(marks.slug.widthPt),
            margin: 0,
            fontSize: u(slug.sizePt),
            lineHeight: 1,
            textAlign: 'center',
            whiteSpace: 'nowrap',
            color: slug.colour,
          }}
        >
          {text}
        </p>
      )}
    </>
  )
}
