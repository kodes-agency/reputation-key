// The Print kit section of the Share tab: which piece, in which languages, with
// which call to action, and the download. What is chosen drives the preview
// beside it; the PDF is made by the server from the same choice.

import { Download, RectangleVertical, Triangle } from 'lucide-react'
import type { ComponentType } from 'react'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import { RegionError } from '#/components/ui/region-error'
import { Skeleton } from '#/components/ui/skeleton'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import {
  PRINT_KIT_CALLS_TO_ACTION,
  PRINT_KIT_CALL_TO_ACTION_LABELS,
  PRINT_KIT_PIECES,
  PRINT_KIT_PIECE_FACTS,
  printKitLanguageChoices,
  type PrintKitCallToAction,
  type PrintKitChoice,
  type PrintKitPiece,
} from '#/shared/domain/portal-print-kit'
import { languageChoiceLabel } from './print-kit-state'

const PIECE_ICONS: Readonly<
  Record<PrintKitPiece, ComponentType<{ className?: string }>>
> = { table_tent: Triangle, counter_card: RectangleVertical }

type Props = Readonly<{
  /** Null while the Portal's languages and look are read. */
  view: PortalPrintKitView | null
  choice: PrintKitChoice | null
  isError: boolean
  onRetry: () => void
  onChoiceChange: (choice: PrintKitChoice) => void
  /** Why the download is off, or null when it is on. */
  unavailableReason: string | null
  isWorking: boolean
  errorMessage: string | null
  onDownload: () => void
}>

export function PortalPrintKitSection({
  view,
  choice,
  isError,
  onRetry,
  onChoiceChange,
  unavailableReason,
  isWorking,
  errorMessage,
  onDownload,
}: Props) {
  return (
    <section className="flex flex-col gap-5" aria-labelledby="print-kit-heading">
      <div className="flex flex-col gap-1">
        <h2 id="print-kit-heading" className="text-lg font-semibold">
          Print kit
        </h2>
        <p className="text-sm text-muted-foreground">
          A print-ready PDF with your code on it, for a print shop or your own printer.
        </p>
      </div>
      {isError && (
        <RegionError
          size="compact"
          message="The print kit couldn’t be loaded."
          onRetry={onRetry}
        />
      )}
      {view === null || choice === null ? (
        !isError && <Loading />
      ) : (
        <Controls view={view} choice={choice} onChoiceChange={onChoiceChange} />
      )}
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          className="min-h-11 self-start sm:min-h-9"
          disabled={
            view === null || choice === null || unavailableReason !== null || isWorking
          }
          onClick={onDownload}
        >
          <Download data-icon="inline-start" />{' '}
          {isWorking ? 'Making the PDF…' : 'Download print kit (PDF)'}
        </Button>
        {unavailableReason !== null && (
          <p className="text-sm text-muted-foreground">{unavailableReason}</p>
        )}
        {errorMessage !== null && (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
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

function Controls({
  view,
  choice,
  onChoiceChange,
}: Readonly<{
  view: PortalPrintKitView
  choice: PrintKitChoice
  onChoiceChange: (choice: PrintKitChoice) => void
}>) {
  const languageChoices = printKitLanguageChoices(view.locales)
  return (
    <>
      <RadioGroup
        aria-label="Piece"
        className="grid grid-cols-2 gap-2"
        value={choice.piece}
        onValueChange={(piece) =>
          onChoiceChange({ ...choice, piece: piece as PrintKitPiece })
        }
      >
        {PRINT_KIT_PIECES.map((piece) => (
          <PieceCard key={piece} piece={piece} />
        ))}
      </RadioGroup>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Languages on the print</legend>
        <RadioGroup
          aria-label="Languages on the print"
          className="flex flex-wrap gap-x-5 gap-y-2"
          value={choice.languages.join('+')}
          onValueChange={(joined) =>
            onChoiceChange({
              ...choice,
              languages:
                languageChoices.find((languages) => languages.join('+') === joined) ??
                choice.languages,
            })
          }
        >
          {languageChoices.map((languages) => (
            <Option
              key={languages.join('+')}
              id={`print-kit-languages-${languages.join('-')}`}
              value={languages.join('+')}
              label={languageChoiceLabel(languages)}
            />
          ))}
        </RadioGroup>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Call to action</legend>
        <RadioGroup
          aria-label="Call to action"
          value={choice.callToAction}
          onValueChange={(callToAction) =>
            onChoiceChange({
              ...choice,
              callToAction: callToAction as PrintKitCallToAction,
            })
          }
        >
          {PRINT_KIT_CALLS_TO_ACTION.map((callToAction) => (
            <Option
              key={callToAction}
              id={`print-kit-cta-${callToAction}`}
              value={callToAction}
              label={PRINT_KIT_CALL_TO_ACTION_LABELS[callToAction]}
            />
          ))}
        </RadioGroup>
      </fieldset>
    </>
  )
}

function PieceCard({ piece }: Readonly<{ piece: PrintKitPiece }>) {
  const Icon = PIECE_ICONS[piece]
  const facts = PRINT_KIT_PIECE_FACTS[piece]
  const id = `print-kit-piece-${piece}`
  return (
    <Label
      htmlFor={id}
      className="relative flex min-h-21 cursor-pointer flex-col items-start justify-end gap-0.5 rounded-md border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
    >
      <Icon className="absolute top-3 left-3 size-5 text-muted-foreground" />
      <RadioGroupItem value={piece} id={id} className="absolute top-3 right-3" />
      <span className="text-[13px] font-medium">{facts.label}</span>
      <span className="text-xs text-muted-foreground">{facts.sizeLabel}</span>
    </Label>
  )
}

function Option({
  id,
  value,
  label,
}: Readonly<{ id: string; value: string; label: string }>) {
  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem value={value} id={id} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  )
}
