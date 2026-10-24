// The Print kit section of the Share tab, top to bottom as the share board draws
// it (spec 7.2, round-3 S7): what to make (style, size, piece, output, paper,
// languages, the name under the logo, call to action), the download with the
// file's name beside it, and how to print what was chosen. What is chosen drives the preview beside it; the PDF is made by the
// server from the same choice. Below `lg` the preview is handed in and sits
// between the choices and the download, so a phone shows what it is about to
// download first.

import { Download } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { RegionError } from '#/components/ui/region-error'
import { Skeleton } from '#/components/ui/skeleton'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import {
  PRINT_KIT_SELECTABLE_SIZES,
  printKitFileName,
  type PrintKitChoice,
  type PrintKitSize,
} from '#/shared/domain/portal-print-kit'
import {
  printKitHowToSteps,
  printKitHowToTitle,
} from '#/shared/domain/portal-print-kit-how-to'
import { PortalPrintKitControls } from './portal-print-kit-controls'
import { PortalPrintKitHowTo } from './portal-print-kit-how-to'

type Props = Readonly<{
  /** Null while the Portal's languages and look are read. */
  view: PortalPrintKitView | null
  choice: PrintKitChoice | null
  isError: boolean
  onRetry: () => void
  /** Try again is reading; the error stays, its button busy. */
  isRetrying?: boolean
  onChoiceChange: (choice: PrintKitChoice) => void
  /** The sizes offered: `PRINT_KIT_SELECTABLE_SIZES` unless a story shows the hidden ones. */
  sizes?: readonly PrintKitSize[]
  /** The bar under each code as the tile makes it ("1.4 in (3.6 cm)"), for "How to print"; null while the tile is not known or the size is refused. */
  barMeasure?: string | null
  /** Names the characters the fonts lack, which the print leaves out; null when all will print. */
  unprintableNote: string | null
  /** Why the download is off, or null when it is on. */
  unavailableReason: string | null
  isWorking: boolean
  onDownload: () => void
  /** The preview, when it sits in the section (below `lg`) rather than beside it. */
  preview?: ReactNode
}>

export function PortalPrintKitSection({
  view,
  choice,
  isError,
  onRetry,
  isRetrying = false,
  onChoiceChange,
  sizes = PRINT_KIT_SELECTABLE_SIZES,
  barMeasure = null,
  unprintableNote,
  unavailableReason,
  isWorking,
  onDownload,
  preview = null,
}: Props) {
  const ready = view !== null && choice !== null
  return (
    <section className="flex flex-col gap-5" aria-labelledby="print-kit-heading">
      <div className="flex flex-col gap-1">
        <h2 id="print-kit-heading" className="text-lg font-semibold">
          Print kit
        </h2>
        <p className="text-sm text-muted-foreground">
          Prints use the version that is live now.
        </p>
      </div>
      {isError && (
        <RegionError
          size="compact"
          message="The print kit couldn’t be loaded."
          onRetry={onRetry}
          retrying={isRetrying}
        />
      )}
      {ready ? (
        <PortalPrintKitControls
          view={view}
          choice={choice}
          sizes={sizes}
          onChoiceChange={onChoiceChange}
        />
      ) : (
        !isError && <Loading />
      )}
      {unprintableNote !== null && (
        <p className="text-sm text-muted-foreground">{unprintableNote}</p>
      )}
      {preview}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            type="button"
            disabled={!ready || unavailableReason !== null}
            pending={isWorking}
            pendingLabel="Making the PDF…"
            aria-describedby={ready ? 'print-kit-file-name' : undefined}
            onClick={onDownload}
          >
            <Download /> Download print kit (PDF)
          </Button>
          {ready && (
            <span
              id="print-kit-file-name"
              className="min-w-0 text-[13px] break-all text-muted-foreground"
            >
              {printKitFileName(view.portalName, choice.piece, choice.languages, choice)}
            </span>
          )}
        </div>
        {unavailableReason !== null && (
          <p className="text-sm text-muted-foreground">{unavailableReason}</p>
        )}
      </div>
      {ready && barMeasure !== null && (
        <PortalPrintKitHowTo
          title={printKitHowToTitle(choice)}
          steps={printKitHowToSteps({
            ...choice,
            languageCount: choice.languages.length,
            bar: barMeasure,
          })}
        />
      )}
    </section>
  )
}

function Loading() {
  return (
    <div
      className="flex flex-col gap-3"
      aria-busy="true"
      aria-label="Loading the print kit"
    >
      <Skeleton className="h-21 w-full" />
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-5 w-1/2" />
    </div>
  )
}
