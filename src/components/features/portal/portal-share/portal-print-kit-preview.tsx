// The print beside the Share tab's section, as the share board draws it (spec
// 7.2): the whole sheet the PDF prints, composed from the same pages, or one
// face of it, with a caption, a Front and Back switch when the print has two
// sides, and a note on what to do with it. It follows the choice and the
// Property's look; the code is the live code's when its address is in memory and
// a sample otherwise, and the note says which.
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
import { PANEL_SIZE_PT, printKitPages } from '#/shared/domain/portal-print-kit-sheets'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { PrintKitFaceArt } from './print-kit-face-art'
import { PrintKitSheetArt } from './print-kit-sheet-art'
import {
  printKitFaceCaption,
  printKitFaceLabel,
  printKitPreviewNote,
  printKitSheetCaption,
  type PrintKitPreviewMode,
} from './print-kit-preview-copy'
import { usePrintKitCode } from './use-print-kit-code'

type Props = Readonly<{
  choice: PrintKitChoice | null
  view: PortalPrintKitView | null
  /** The faces as the file prints them (`printableFace`). */
  faces: readonly PrintFace[]
  mode: PrintKitPreviewMode
  onModeChange: (mode: PrintKitPreviewMode) => void
  side: PrintFaceSide
  onSideChange: (side: PrintFaceSide) => void
  /** The live code's QR address, when it is in memory. */
  qrAddress: string | null
  isError: boolean
  onRetry: () => void
  /** Try again is reading; the error stays, its button busy. */
  isRetrying?: boolean
  /** A column beside the section, or inline in it. */
  placement: 'column' | 'inline'
}>

const MODE_OPTIONS = [
  { value: 'sheet', label: 'Whole sheet' },
  { value: 'face', label: 'One face' },
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
  qrAddress,
  isError,
  onRetry,
  isRetrying = false,
  placement,
}: Props) {
  const codeUrl = usePrintKitCode(qrAddress)
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
            options={MODE_OPTIONS}
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
              codeUrl={codeUrl}
              sample={qrAddress === null}
            />
          </figure>
        )}
      </section>
    </div>
  )
}

/** The caption, the art and the notes under it, for the mode the manager chose. */
function Drawing({
  choice,
  view,
  faces,
  mode,
  side,
  codeUrl,
  sample,
}: Readonly<{
  choice: PrintKitChoice
  view: PortalPrintKitView
  faces: readonly PrintFace[]
  mode: PrintKitPreviewMode
  side: PrintFaceSide
  codeUrl: string | null
  sample: boolean
}>) {
  const { style, piece, paper } = choice
  const pages = printKitPages(piece, faces.length, style, paper)
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
            paper={paper}
            faces={faces}
            look={view.look}
            codeUrl={codeUrl}
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
            codeUrl={codeUrl}
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
