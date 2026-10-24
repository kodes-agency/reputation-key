// The whole sheet a print comes out as (spec 4.3, 4.4 and 5.3, round-3 S5 and S6),
// composed from the same pages the PDF draws (`printKitSheetPages`): each face in
// its slot, turned upside down above a tent's fold or a quarter in a Mini's
// business-card cell. A Paper sheet carries grey ticks where it is cut or folded,
// a note, and on the Letter card sheet the print check in the strip that is cut
// away; an Immersive print-shop page has the field run into the bleed, crop and
// fold marks and the slug line; an Immersive office sheet has its cards' bleed,
// plain black crop marks and a note. So the Whole sheet view cannot show a sheet
// the file does not print.
//
// Laid out in container units of the sheet's width; the faces in their slots
// lay themselves out in their own. Inline styles, as the rest of the preview.

import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import {
  defaultPrintKitOutput,
  type PrintFace,
  type PrintKitOutput,
  type PrintKitPaper,
  type PrintKitPiece,
  type PrintKitSize,
  type PrintKitStyle,
} from '#/shared/domain/portal-print-kit'
import { CODE_TILE, type CodeTile } from '#/shared/domain/portal-print-kit-code-tile'
import { PRINT_SHOP_PAGE } from '#/shared/domain/portal-print-kit-immersive'
import { CODE_BLOCK } from '#/shared/domain/portal-print-kit-measures'
import {
  PRINT_KIT_PAPER,
  immersivePrintKitPalette,
  paperPrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import { OFFICE_CROP_COLOUR } from '#/shared/domain/portal-print-kit-sheet-parts'
import {
  PANEL_SIZE_PT,
  PRINT_CHECK,
  TICK,
  printCheckLines,
} from '#/shared/domain/portal-print-kit-sheets'
import type { PointsToLength } from './print-kit-code-block-layout'
import { PrintKitFaceArt } from './print-kit-face-art'
import { ptToContainerWidth } from './print-kit-paper-art-layout'
import { printKitSheetCaption } from './print-kit-preview-copy'
import { PrintShopGrounds, PrintShopMarks } from './print-kit-print-shop-art'
import { previewSheetPages } from './print-kit-sheet-pages'
import { SheetNoteArt } from './print-kit-sheet-note-art'

type Props = Readonly<{
  /** Paper by default: the style a download makes when it names none. */
  style?: PrintKitStyle
  piece: PrintKitPiece
  /** Large by default, the size a download makes when it names none. */
  size?: PrintKitSize
  /** The style's own by default: a print shop for Immersive, the office printer for Paper. */
  output?: PrintKitOutput
  paper: PrintKitPaper
  /** The piece's faces (`printKitFaces`): a card's back is on the second page. */
  faces: readonly PrintFace[]
  look: PortalPrintKitView['look']
  codeUrl: string | null
  /** The code tile of a card or the small tent, the one its address allows; the size's own tile when none is given. */
  tile?: CodeTile
  /** The property's name under a logo, which the manager may turn off; on when left out. */
  showPropertyName?: boolean
  /** Which page of the print: 0 for the fronts, 1 for a card's backs. */
  page?: number
}>

function PrintCheck({
  accent,
  tilePt,
  u,
}: Readonly<{ accent: string; tilePt: number; u: PointsToLength }>) {
  const palette = paperPrintKitPalette(accent)
  const { title, lines } = PRINT_CHECK
  // As wide as the cards' code tile, as the bar under each code is.
  const bar = { ...PRINT_CHECK.bar, widthPt: tilePt }
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
          // Outside the bar, so the bar itself measures the tile.
          boxShadow: `0 0 0 ${u(CODE_BLOCK.outlinePt)} ${palette.accentInk}`,
        }}
      />
      <p style={{ margin: 0, fontSize: u(lines.sizePt), lineHeight: lines.leading }}>
        {printCheckLines(tilePt).map((line) => (
          <span key={line} style={{ display: 'block' }}>
            {line}
          </span>
        ))}
      </p>
    </div>
  )
}

/** The transform of a panel: upside down above a fold, a quarter turned in a business-card cell. */
const turnOf = (panel: { rotated: boolean; turned: boolean }): string | undefined => {
  const turns = [
    panel.rotated ? 'rotate(180deg)' : null,
    panel.turned ? 'rotate(-90deg)' : null,
  ].filter((turn) => turn !== null)
  return turns.length === 0 ? undefined : turns.join(' ')
}

export function PrintKitSheetArt({
  style = 'paper',
  piece,
  size = 'large',
  output = defaultPrintKitOutput(style),
  paper,
  faces,
  look,
  codeUrl,
  tile,
  showPropertyName = true,
  page = 0,
}: Props) {
  const cardTile = tile ?? CODE_TILE[size][paper]
  // A choice the kit does not make has no pages: the Share tab never offers one.
  const pages = previewSheetPages(
    { piece, size, style, output, paper },
    faces,
    cardTile.tilePt,
  )
  if (pages === null) return null
  const index = Math.min(Math.max(0, page), pages.length - 1)
  const sheet = pages[index]
  if (sheet === undefined) return null
  const u: PointsToLength = (points) => ptToContainerWidth(points, sheet.widthPt)
  const immersive = style === 'immersive'
  const position = { index, count: pages.length, faces: sheet.panels.length }
  const tickColour = sheet.marks === 'office-crop' ? OFFICE_CROP_COLOUR : TICK.colour
  return (
    <div
      role="img"
      aria-label={printKitSheetCaption({ style, piece, size, output, paper }, position)}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${sheet.widthPt} / ${sheet.heightPt}`,
        containerType: 'inline-size',
        overflow: 'hidden',
        // A print shop's sheet is white round the bleed; Paper shows the board's paper tone.
        background: immersive ? PRINT_SHOP_PAGE : PRINT_KIT_PAPER,
        fontFamily: 'var(--font-guest-body)',
      }}
    >
      {immersive && (
        <PrintShopGrounds
          page={sheet}
          palette={immersivePrintKitPalette(look.accentColour, look.fieldColour)}
          u={u}
        />
      )}
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
              transform: turnOf(panel),
            }}
          >
            <PrintKitFaceArt
              style={style}
              bare={immersive}
              geometry={panel.geometry}
              face={face}
              look={look}
              codeUrl={codeUrl}
              tile={cardTile}
              bleed={panel.bleed}
              showPropertyName={showPropertyName}
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
            background: tickColour,
          }}
        />
      ))}
      {sheet.note !== null && <SheetNoteArt note={sheet.note} u={u} />}
      {sheet.printCheck && (
        <PrintCheck accent={look.accentColour} tilePt={cardTile.tilePt} u={u} />
      )}
      {sheet.marks === 'crop' && (
        <PrintShopMarks
          page={sheet}
          piece={piece}
          size={size}
          paper={paper}
          faces={faces}
          wordmark={look.wordmark}
          u={u}
        />
      )}
    </div>
  )
}
