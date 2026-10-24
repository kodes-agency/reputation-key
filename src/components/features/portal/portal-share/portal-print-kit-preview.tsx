// The print beside the Share tab's section, as the share board draws it (spec
// 7.2): the whole sheet the PDF prints, composed from the same pages, or one
// face of it, with a caption, a Front and Back switch when the print has two
// sides, and a note on what to do with it. It follows the choice (its size, piece
// and output included) and the Property's look; the code is the live code's when
// its address is in memory and a sample otherwise, and the note says which. A size
// whose tile would print the live address too small is not drawn: the preview says
// what to do instead, in the server's own words.
//
// It sits in a column of its own from `lg`, sticky beside the section; below
// that the section holds it inline, between the choices and the download.

import { PAGE_GUTTER_X } from '#/components/layout/page-shell'
import { RegionError } from '#/components/ui/region-error'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { Skeleton } from '#/components/ui/skeleton'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { cn } from '#/lib/utils'
import type {
  PrintFace,
  PrintFaceSide,
  PrintKitChoice,
} from '#/shared/domain/portal-print-kit'
import {
  PRINT_CODE_TOO_SMALL_COPY,
  type CodeTileChoice,
  type PrintCodeTooSmall,
} from '#/shared/domain/portal-print-kit-code-tile'
import type { Result } from '#/shared/domain/result'
import { PANEL_SIZE_PT } from '#/shared/domain/portal-print-kit-sheets'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { PrintKitFaceArt } from './print-kit-face-art'
import { PrintKitSheetArt } from './print-kit-sheet-art'
import { previewSheetPages } from './print-kit-sheet-pages'
import {
  printKitFaceCaption,
  printKitFaceLabel,
  printKitPreviewNote,
  printKitSheetCaption,
  type PrintKitPreviewMode,
} from './print-kit-preview-copy'
import type { PrintKitCode } from './use-print-kit-code'

type Props = Readonly<{
  choice: PrintKitChoice | null
  view: PortalPrintKitView | null
  /** The faces as the file prints them (`printableFace`). */
  faces: readonly PrintFace[]
  mode: PrintKitPreviewMode
  onModeChange: (mode: PrintKitPreviewMode) => void
  side: PrintFaceSide
  onSideChange: (side: PrintFaceSide) => void
  /** The code the preview draws: the live code's address when it is in memory, else a sample. */
  code: PrintKitCode
  /** Whether that code is the sample. */
  sample: boolean
  /** The tile the file would print the code on, or why it would not: from the same rule the file asks. */
  tile: Result<CodeTileChoice, PrintCodeTooSmall> | null
  isError: boolean
  onRetry: () => void
  /** Try again is reading; the error stays, its button busy. */
  isRetrying?: boolean
  /** A column beside the section, or inline in it. */
  placement: 'column' | 'inline'
}>

/** A card is "One card", a tent's side "One face": the board's words for what the toggle shows. */
const modeOptions = (piece: PrintKitChoice['piece']) =>
  [
    { value: 'sheet', label: 'Whole sheet' },
    { value: 'face', label: piece === 'counter_card' ? 'One card' : 'One face' },
  ] as const

const SIDE_OPTIONS = [
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
] as const

/** The largest a whole sheet is drawn, as the board draws a Letter sheet: 424 px wide. */
const SHEET_MAX = { widthRem: 26.5, heightRem: 42 } as const
/** The sheet's edge and its lift off the panel, as the board draws them. */
const SHEET_SHADOW = '0 0 0 1px var(--border), 0 8px 28px rgb(0 0 0 / 0.35)'
/** The largest a face on its own is drawn. */
const FACE_MAX = { widthRem: 28, heightRem: 34 } as const

/** A width for a sheet or face of this shape: as wide as it may be, and no taller than `max`. */
function widthFor(
  shape: Readonly<{ widthPt: number; heightPt: number }>,
  max: Readonly<{ widthRem: number; heightRem: number }>,
): string {
  const rem = Math.min(max.widthRem, (max.heightRem * shape.widthPt) / shape.heightPt)
  return `min(100%, ${Number(rem.toFixed(2))}rem)`
}

export function PortalPrintKitPreview({
  choice,
  view,
  faces,
  mode,
  onModeChange,
  side,
  onSideChange,
  code,
  sample,
  tile,
  isError,
  onRetry,
  isRetrying = false,
  placement,
}: Props) {
  const column = placement === 'column'
  return (
    <div className={cn(column && 'min-w-0 flex-1 bg-muted/40')}>
      <section
        aria-labelledby="print-preview-heading"
        className={cn(
          'flex flex-col gap-4',
          column
            ? cn(PAGE_GUTTER_X, 'py-5 lg:sticky lg:top-0')
            : 'rounded-lg bg-muted/40 p-4',
        )}
      >
        {/* The guest fonts are linked here: the Share tab is not a guest route, so
          nothing else loads them. React hoists and de-duplicates the tag. */}
        <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
        <h2 id="print-preview-heading" className="sr-only">
          Print preview
        </h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SegmentedControl
            aria-label="Preview"
            value={mode}
            onValueChange={(next) => onModeChange(next as PrintKitPreviewMode)}
            options={modeOptions(choice?.piece ?? 'counter_card')}
            touch
          />
          {faces.length > 1 && (
            <SegmentedControl
              aria-label="Side of the print"
              value={side}
              onValueChange={(next) => onSideChange(next as PrintFaceSide)}
              options={SIDE_OPTIONS}
              touch
            />
          )}
        </div>
        {isError ? (
          <RegionError
            size="compact"
            message="The preview couldn’t be loaded."
            onRetry={onRetry}
            retrying={isRetrying}
          />
        ) : view === null || choice === null ? (
          <Skeleton
            className="mx-auto w-full max-w-md"
            style={{ aspectRatio: '17 / 22' }}
          />
        ) : (
          <figure className="mx-auto flex w-full flex-col items-center gap-3">
            <Drawing
              choice={choice}
              view={view}
              faces={faces}
              mode={mode}
              side={side}
              code={code}
              sample={sample}
              tile={tile}
            />
          </figure>
        )}
      </section>
    </div>
  )
}

/** What the preview says in place of a size it cannot draw: what to do, in the server's own words. */
function Refused({ refusal }: Readonly<{ refusal: PrintCodeTooSmall }>) {
  return (
    <p className="max-w-md text-center text-sm text-balance text-muted-foreground">
      {PRINT_CODE_TOO_SMALL_COPY[refusal.cause]}
    </p>
  )
}

/** The caption, the art and the notes under it, for the mode the manager chose. */
function Drawing({
  choice,
  view,
  faces,
  mode,
  side,
  code,
  sample,
  tile,
}: Readonly<{
  choice: PrintKitChoice
  view: PortalPrintKitView
  faces: readonly PrintFace[]
  mode: PrintKitPreviewMode
  side: PrintFaceSide
  code: PrintKitCode
  sample: boolean
  tile: Result<CodeTileChoice, PrintCodeTooSmall> | null
}>) {
  const { style, piece, paper, size, output, showPropertyName } = choice
  if (tile === null) return null
  // A card's tile is the one its address allows, as in the file; a size that has none is not drawn.
  if (tile.isErr()) return <Refused refusal={tile.error} />
  const cardTile = tile.value.tile
  // A print the kit does not make has no pages; the controls never offer one.
  const pages = previewSheetPages(
    { piece, size, style, output, paper },
    faces,
    cardTile.tilePt,
  )
  if (pages === null) return null
  // A card's backs are its second page; a tent is one sheet with both faces.
  const index = side === 'back' && pages.length > 1 ? 1 : 0
  const page = pages[index]
  const face = faces.find((candidate) => candidate.side === side) ?? faces[0]
  const geometry = pages
    .flatMap((candidate) => candidate.panels)
    .find((panel) => panel.side === face?.side)?.geometry
  if (page === undefined || face === undefined || geometry === undefined) return null
  const position = { index, count: pages.length, faces: page.panels.length }
  const sheet = mode === 'sheet'
  return (
    <>
      <figcaption className="self-start text-[13px] text-muted-foreground">
        {sheet
          ? printKitSheetCaption(choice, position)
          : printKitFaceCaption(choice, face.side)}
      </figcaption>
      {sheet ? (
        <div style={{ width: widthFor(page, SHEET_MAX), boxShadow: SHEET_SHADOW }}>
          <PrintKitSheetArt
            style={style}
            piece={piece}
            size={size}
            output={output}
            paper={paper}
            faces={faces}
            look={view.look}
            codeUrl={code.url}
            tile={cardTile}
            showPropertyName={showPropertyName}
            page={index}
          />
        </div>
      ) : (
        <div style={{ width: widthFor(PANEL_SIZE_PT[geometry], FACE_MAX) }}>
          <PrintKitFaceArt
            style={style}
            geometry={geometry}
            face={face}
            look={view.look}
            codeUrl={code.url}
            tile={cardTile}
            showPropertyName={showPropertyName}
            label={printKitFaceLabel(choice, face)}
          />
        </div>
      )}
      <p className="max-w-md text-center text-[13px] text-balance text-muted-foreground">
        {printKitPreviewNote(choice, faces)}
      </p>
      {sample && (
        <p className="max-w-md text-center text-xs text-muted-foreground">
          The preview draws a sample code. The PDF carries your live code.
        </p>
      )}
    </>
  )
}
