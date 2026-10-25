// The final Print cards section of the Share tab (final design spec §11, the
// boards share-desktop-light, share-desktop-dark and share-phone), shown where
// the server says PRINT_KIT_FINAL_ENABLED; today's section is untouched
// otherwise. Top to bottom: when the Portal was last printed, what is printed
// and which way up, the look, who prints it, how many, the words, then the
// download with its summary and How to print for the chosen layout. The preview
// sits beside it from `lg`; below that, the phone's pinned bar holds the summary,
// Preview and the download.

import { Download } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { RegionError } from '#/components/ui/region-error'
import { Skeleton } from '#/components/ui/skeleton'
import { useIsBelowLarge } from '#/components/hooks/use-mobile'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import {
  printFinalHowToSteps,
  printFinalSummary,
} from '#/shared/domain/portal-print-final-how-to'
import { PortalPrintKitHowTo } from './portal-print-kit-how-to'
import {
  PrintFinalLookStep,
  PrintFinalWhatStep,
  PrintFinalWhoStep,
} from './portal-print-final-choices'
import { PrintFinalHowManyStep, PrintFinalWordsStep } from './portal-print-final-amounts'
import { PrintFinalLastPrintNotice } from './print-final-last-print-notice'
import type { PrintFinalState } from './use-print-final'

type Props = Readonly<{
  final: PrintFinalState
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
export function PrintFinalSummaryLine({
  final,
  phone = false,
  className,
}: Readonly<{ final: PrintFinalState; phone?: boolean; className?: string }>) {
  if (final.print === null || final.count === null) return null
  const { lead, rest } = printFinalSummary(final.print, final.count, phone)
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
export function PrintFinalDownloadButton({
  final,
  unavailableReason,
  size,
  className,
}: Readonly<{
  final: PrintFinalState
  unavailableReason: string | null
  size?: 'lg'
  className?: string
}>) {
  const block = unavailableReason === null ? null : final.words.block
  return (
    <Button
      type="button"
      size={size}
      className={className}
      disabled={final.print === null || unavailableReason !== null}
      pending={final.isWorking}
      pendingLabel="Making the PDF…"
      aria-describedby="print-final-summary"
      onClick={() => void final.download()}
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
  final,
  unavailableReason,
}: Readonly<{ final: PrintFinalState; unavailableReason: string | null }>) {
  // The words' own reason sits beside the button; any other reason goes under the row.
  const wordsNote = unavailableReason !== null ? (final.words.block?.note ?? null) : null
  const besideIsReason = wordsNote !== null && wordsNote === unavailableReason
  return (
    <div className="hidden gap-2 lg:grid">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PrintFinalDownloadButton final={final} unavailableReason={unavailableReason} />
        {besideIsReason ? (
          <span className="text-[13px] text-muted-foreground">{wordsNote}</span>
        ) : (
          <PrintFinalSummaryLine
            final={final}
            className="text-[13px] text-muted-foreground"
          />
        )}
        <span id="print-final-summary" className="sr-only">
          {final.fileName}
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

export function PortalPrintFinalSection({
  final,
  view,
  countryCode,
  isError,
  onRetry,
  isRetrying = false,
  unavailableReason,
}: Props) {
  const phone = useIsBelowLarge()
  const { print, tile } = final
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
          <PrintFinalLastPrintNotice final={final} />
          <PrintFinalWhatStep final={final} print={print} view={view} />
          <PrintFinalLookStep final={final} print={print} view={view} />
          <PrintFinalWhoStep
            final={final}
            print={print}
            view={view}
            countryCode={countryCode}
          />
          <PrintFinalHowManyStep final={final} print={print} view={view} />
          <PrintFinalWordsStep final={final} print={print} view={view} />
          <div className="flex flex-col gap-3 border-t pt-4">
            <DownloadRow final={final} unavailableReason={unavailableReason} />
            {phone && unavailableReason !== null && (
              <p className="text-sm text-muted-foreground">{unavailableReason}</p>
            )}
            {tile !== null && (
              <PortalPrintKitHowTo
                steps={printFinalHowToSteps(print, tile.tilePt, phone)}
              />
            )}
          </div>
        </>
      ) : (
        !isError && <Loading />
      )}
    </section>
  )
}
