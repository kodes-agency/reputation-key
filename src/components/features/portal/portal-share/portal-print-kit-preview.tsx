// The print on the right of the Share tab, as board 06 draws it: the face the
// manager is choosing, at the size it will print, with its crop marks, and a
// Front and Back switch when the print has two sides. It follows the choice and
// the Property's look; the code is the live code's when its address is in
// memory and a sample otherwise, and the caption says which.

import { Button } from '#/components/ui/button'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { Skeleton } from '#/components/ui/skeleton'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import {
  shortPrintAddress,
  type PrintFace,
  type PrintFaceSide,
  type PrintKitPiece,
} from '#/shared/domain/portal-print-kit'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { PrintKitArt } from './print-kit-art'
import { printKitCaptions } from './print-kit-state'
import { usePrintKitCode } from './use-print-kit-code'

/** Shown under the card when the live address is not in memory. */
const SAMPLE_ADDRESS_TEXT = 'Your public address'

type Props = Readonly<{
  piece: PrintKitPiece
  view: PortalPrintKitView | null
  faces: readonly PrintFace[]
  face: PrintFace | null
  side: PrintFaceSide
  onSideChange: (side: PrintFaceSide) => void
  /** The live code's QR address, when it is in memory. */
  qrAddress: string | null
  isError: boolean
  onRetry: () => void
}>

const SIDE_OPTIONS = [
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
] as const

export function PortalPrintKitPreview({
  piece,
  view,
  faces,
  face,
  side,
  onSideChange,
  qrAddress,
  isError,
  onRetry,
}: Props) {
  const codeUrl = usePrintKitCode(qrAddress)
  const captions = printKitCaptions(piece, side)
  return (
    <div className="min-w-0 flex-1 bg-muted/40">
      <section
        aria-labelledby="print-preview-heading"
        className="flex flex-col gap-4 px-4 py-5 md:px-6 lg:sticky lg:top-0"
      >
        {/* The guest fonts are linked here: the Share tab is not a guest route, so
          nothing else loads them. React hoists and de-duplicates the tag. */}
        <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
        <div className="flex items-center justify-between gap-3">
          <h2 id="print-preview-heading" className="sr-only">
            Print preview
          </h2>
          {faces.length > 1 ? (
            <SegmentedControl
              aria-label="Side of the print"
              value={side}
              onValueChange={(next) => onSideChange(next as PrintFaceSide)}
              options={SIDE_OPTIONS}
            />
          ) : (
            <span />
          )}
        </div>
        {isError ? (
          <p className="text-sm text-muted-foreground" role="status">
            The preview could not be loaded.{' '}
            <Button type="button" variant="link" className="h-auto p-0" onClick={onRetry}>
              Try again
            </Button>
          </p>
        ) : view === null || face === null ? (
          <Skeleton className="mx-auto aspect-125/168 w-full max-w-md" />
        ) : (
          <figure className="mx-auto flex w-full max-w-md flex-col items-center gap-3">
            <figcaption className="text-center text-[13px] text-muted-foreground">
              {captions.top}
            </figcaption>
            <PrintKitArt
              piece={piece}
              face={face}
              look={view.look}
              codeUrl={codeUrl}
              shortAddress={
                qrAddress === null ? SAMPLE_ADDRESS_TEXT : shortPrintAddress(qrAddress)
              }
            />
            <p className="text-center text-xs text-muted-foreground">{captions.bottom}</p>
            {qrAddress === null && (
              <p className="text-center text-xs text-muted-foreground">
                The preview draws a sample code. The PDF carries your live code.
              </p>
            )}
          </figure>
        )}
      </section>
    </div>
  )
}
