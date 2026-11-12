// The Share tab's Print cards choices, last-print memory, wording and download.
// The preview sits beside it from lg; the phone's pinned bar holds Preview and Download.

import { Download } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { RegionError } from '#/components/ui/region-error'
import { Skeleton } from '#/components/ui/skeleton'
import { useIsBelowLarge } from '#/components/hooks/use-mobile'
import type { PortalPrintKitView } from '#/contexts/portal/application/portal-management-contracts'
import { printHowToSteps, printSummary } from '#/shared/domain/portal-print-how-to'
import { PortalPrintKitHowTo } from './portal-print-kit-how-to'
import { PrintLookStep, PrintWhatStep, PrintWhoStep } from './portal-print-choices'
import { PrintHowManyStep, PrintWordsStep } from './portal-print-amounts'
import { PrintLastPrintNotice } from './print-last-print-notice'
import type { PrintState } from './use-print'

type Props = Readonly<{
  printState: PrintState
  /** Null while the Portal's languages and look are read. */
  view: PortalPrintKitView | null
  countryCode: string | null
  isError: boolean
  onRetry: () => void
  isRetrying?: boolean
  /** Why the download is off, or null when it is on. */
  unavailableReason: string | null
}>

/** "3 sheets · 10 tents · wide · Letter · one side · English + Español", its count in bold. */
export function PrintSummaryLine({
  printState,
  phone = false,
  className,
}: Readonly<{ printState: PrintState; phone?: boolean; className?: string }>) {
  if (printState.print === null || printState.count === null) return null
  const { lead, rest } = printSummary(printState.print, printState.count, phone)
  return (
    <span className={className}>
      <strong className="font-semibold text-foreground">{lead}</strong> · {rest}
    </span>
  )
}

/**
 * Download, or the words that hold it back (§11.5): "Shorten to fit", "Choose
 * words that fit" or "Remove the offer to print", with why beside it. A warning
 * never holds it back.
 */
export function PrintDownloadButton({
  printState,
  unavailableReason,
  size,
  className,
}: Readonly<{
  printState: PrintState
  unavailableReason: string | null
  size?: 'lg'
  className?: string
}>) {
  const block = unavailableReason === null ? null : printState.words.block
  return (
    <Button
      type="button"
      size={size}
      className={className}
      disabled={printState.print === null || unavailableReason !== null}
      pending={printState.isWorking}
      pendingLabel="Making the PDF…"
      aria-describedby="print-final-summary"
      onClick={() => void printState.download()}
    >
      {block === null || block.label === 'Download PDF' ? (
        <>
          <Download /> Download PDF
        </>
      ) : (
        block.label
      )}
    </Button>
  )
}

function DownloadRow({
  printState,
  unavailableReason,
}: Readonly<{ printState: PrintState; unavailableReason: string | null }>) {
  // The words' own reason sits beside the button; any other reason goes under the row.
  const wordsNote =
    unavailableReason !== null ? (printState.words.block?.note ?? null) : null
  const besideIsReason = wordsNote !== null && wordsNote === unavailableReason
  return (
    <div className="hidden gap-2 lg:grid">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PrintDownloadButton
          printState={printState}
          unavailableReason={unavailableReason}
        />
        {besideIsReason ? (
          <span className="text-[13px] text-muted-foreground">{wordsNote}</span>
        ) : (
          <PrintSummaryLine
            printState={printState}
            className="text-[13px] text-muted-foreground"
          />
        )}
        <span id="print-final-summary" className="sr-only">
          {printState.fileName}
        </span>
      </div>
      {unavailableReason !== null && !besideIsReason && (
        <p className="text-sm text-muted-foreground">{unavailableReason}</p>
      )}
    </div>
  )
}

function Loading() {
  return (
    <div
      className="flex flex-col gap-3"
      aria-busy="true"
      aria-label="Loading print cards"
    >
      <Skeleton className="h-21 w-full" />
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-20 w-full" />
    </div>
  )
}

export function PortalPrintSection({
  printState,
  view,
  countryCode,
  isError,
  onRetry,
  isRetrying = false,
  unavailableReason,
}: Props) {
  const phone = useIsBelowLarge()
  const { print, tile } = printState
  return (
    <section className="flex flex-col gap-5" aria-labelledby="print-final-heading">
      <div className="flex flex-col gap-0.5">
        <h2 id="print-final-heading" className="text-lg font-semibold">
          Print cards
        </h2>
        <p className="text-sm text-muted-foreground">
          Tents and cards with your code. Guests scan to rate their visit; the card opens
          your live page.
        </p>
      </div>
      {isError && (
        <RegionError
          size="compact"
          message="Print cards couldn’t be loaded."
          onRetry={onRetry}
          retrying={isRetrying}
        />
      )}
      {view !== null && print !== null ? (
        <>
          <PrintLastPrintNotice printState={printState} />
          <PrintWhatStep printState={printState} print={print} view={view} />
          <PrintLookStep printState={printState} print={print} view={view} />
          <PrintWhoStep
            printState={printState}
            print={print}
            view={view}
            countryCode={countryCode}
          />
          <PrintHowManyStep printState={printState} print={print} view={view} />
          <PrintWordsStep printState={printState} print={print} view={view} />
          {view.personal ? (
            <p className="text-sm text-muted-foreground">
              The phone shows this opening line too. Cards already printed stay the same.
            </p>
          ) : null}
          <div className="flex flex-col gap-3 border-t pt-4">
            <DownloadRow printState={printState} unavailableReason={unavailableReason} />
            {phone && unavailableReason !== null && (
              <p className="text-sm text-muted-foreground">{unavailableReason}</p>
            )}
            {tile !== null && (
              <PortalPrintKitHowTo steps={printHowToSteps(print, tile.tilePt, phone)} />
            )}
          </div>
        </>
      ) : (
        !isError && <Loading />
      )}
    </section>
  )
}
