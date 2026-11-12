// The last two steps of the Print cards section (design spec §11.4
// and §11.5, the boards share-desktop-light and share-phone): how many, with the
// exact sheets it takes and the spares checkbox, and the words: an ordered pair
// of languages, the call to action (its menu and "Write your own…"), and More options: the count a sheet, or for a
// print shop the crop marks, and a card's back page. A print shop's file is one
// piece per page, so How many is not asked for it.

import { ChevronRight } from 'lucide-react'
import { FormSelectField } from '#/components/forms/form-select-field'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import type { PortalPrintKitView } from '#/contexts/portal/application/portal-management-contracts'
import { PRINT_BACK_HELP, PRINT_BACK_LABEL } from '#/shared/domain/portal-print-back-copy'
import { printHasBack } from '#/shared/domain/portal-print-back'
import {
  PRINT_SHOP_CROP_MARKS_HELP,
  PRINT_SHOP_CROP_MARKS_LABEL,
} from '#/shared/domain/portal-print-shop-copy'
import {
  printLanguageChoiceLabel,
  printLanguageChoices,
  printLanguageValue,
} from '#/shared/domain/portal-print-languages'
import { PRINT_PER_SHEET } from '#/shared/domain/portal-print-offer'
import {
  PRINT_PAPER_NAMES,
  PRINT_PIECE_FACTS,
  printSheetsLabel,
  printSparesNote,
} from '#/shared/domain/portal-print-share'
import { Step } from './portal-print-choices'
import { PrintCtaSelect } from './print-cta-select'
import { PrintOwnWords } from './print-own-words'
import { PrintSaveWording } from './print-save-wording'
import type { PrintSharePrint } from './print-state'
import type { PrintState } from './use-print'

type StepProps = Readonly<{
  printState: PrintState
  print: PrintSharePrint
  view: PortalPrintKitView
}>

const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

function Spares({
  printState,
  print,
  quantity,
}: StepProps & Readonly<{ quantity: number }>) {
  const { spares, note } = printSparesNote(quantity, print.perSheet)
  if (spares === 0) return <p className="text-xs text-muted-foreground">{note}</p>
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id="print-final-spares"
        checked={print.fillSpares}
        onCheckedChange={(checked) => printState.change({ fillSpares: checked === true })}
        aria-describedby="print-final-spares-note"
        className="mt-0.5"
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor="print-final-spares" className="font-normal">
          Fill the last sheet with spares
        </Label>
        <p id="print-final-spares-note" className="text-xs text-muted-foreground">
          {note}
        </p>
      </div>
    </div>
  )
}

export function PrintHowManyStep(props: StepProps) {
  const { printState, print } = props
  if (print.printer === 'print_shop') return null
  const { noun } = PRINT_PIECE_FACTS[print.piece]
  const { quantity } = print
  return (
    <Step title="How many?">
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="print-final-quantity" className="text-sm font-normal">
          {capitalised(noun)} you need
        </Label>
        <Input
          id="print-final-quantity"
          inputMode="numeric"
          autoComplete="off"
          value={printState.choice.quantityText}
          onChange={(event) => printState.change({ quantityText: event.target.value })}
          aria-invalid={quantity === null}
          aria-describedby="print-final-sheets"
          className="w-20"
        />
        <span id="print-final-sheets" className="text-[13px] text-muted-foreground">
          {quantity === null ? (
            'Enter how many you need, from 1 to 1000.'
          ) : (
            <>
              <strong className="font-semibold text-foreground">
                {printSheetsLabel(printState.count?.sheets ?? 1)}
              </strong>{' '}
              of {print.perSheet} · {PRINT_PAPER_NAMES[print.paper]}
            </>
          )}
        </span>
      </div>
      {quantity !== null && <Spares {...props} quantity={quantity} />}
    </Step>
  )
}

function PerSheetSelect({ printState, print }: StepProps) {
  const fits = PRINT_PER_SHEET[print.piece][print.look][print.paper]
  const { noun } = PRINT_PIECE_FACTS[print.piece]
  const options = Array.from({ length: fits }, (_, index) => fits - index).map(
    (count) => ({
      value: String(count),
      label: count === fits ? `${count}, as many as fit` : String(count),
    }),
  )
  return (
    <FormSelectField
      id="print-final-per-sheet"
      label={`${capitalised(noun)} per sheet`}
      value={String(print.perSheet)}
      onValueChange={(value) => printState.change({ perSheet: Number(value) })}
      options={options}
      className="max-w-xs"
    />
  )
}

/** The optional back page of a card: logo and property name on the back, for a holder seen from both sides. */
function BackPageOption({ printState, print }: StepProps) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id="print-final-back"
        checked={print.backPage}
        onCheckedChange={(checked) => printState.change({ backPage: checked === true })}
        aria-describedby="print-final-back-help"
        className="mt-0.5"
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor="print-final-back" className="font-normal">
          {PRINT_BACK_LABEL}
        </Label>
        <p id="print-final-back-help" className="text-xs text-muted-foreground">
          {PRINT_BACK_HELP}
        </p>
      </div>
    </div>
  )
}

/** A print shop's crop marks: a checkbox like the back page, off unless asked for, because most shops find the cut from the file itself. */
function CropMarksOption({ printState, print }: StepProps) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id="print-final-crop-marks"
        checked={print.cropMarks}
        onCheckedChange={(checked) => printState.change({ cropMarks: checked === true })}
        aria-describedby="print-final-crop-marks-help"
        className="mt-0.5"
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor="print-final-crop-marks" className="font-normal">
          {PRINT_SHOP_CROP_MARKS_LABEL}
        </Label>
        <p id="print-final-crop-marks-help" className="text-xs text-muted-foreground">
          {PRINT_SHOP_CROP_MARKS_HELP}
        </p>
      </div>
    </div>
  )
}

function MoreOptions(props: StepProps) {
  const { print } = props
  const { noun } = PRINT_PIECE_FACTS[print.piece]
  // The office printer's sheets hold several pieces; a print shop's file is one page, which may have marks.
  const shop = print.printer === 'print_shop'
  const back = printHasBack(print.piece)
  const hint = [shop ? 'crop marks' : `${noun} per sheet`, back ? 'a back page' : null]
    .filter((part) => part !== null)
    .join(', ')
  return (
    <details className="group">
      <summary className="focus-ring flex min-h-9 w-fit cursor-pointer items-center gap-1.5 text-[13px] text-muted-foreground">
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 transition-transform group-open:rotate-90"
        />
        More options
        <span className="hidden sm:inline">· {hint}</span>
      </summary>
      <div className="mt-2 flex flex-col gap-3">
        {shop ? <CropMarksOption {...props} /> : <PerSheetSelect {...props} />}
        {back && <BackPageOption {...props} />}
      </div>
    </details>
  )
}

export function PrintWordsStep(props: StepProps) {
  const { printState, print, view } = props
  const choices = printLanguageChoices(view.locales)
  return (
    <Step title="Words">
      <FormSelectField
        id="print-final-languages"
        label="Languages"
        value={printLanguageValue(print.languages)}
        onValueChange={(value) =>
          printState.change({
            languages:
              choices.find((languages) => printLanguageValue(languages) === value) ??
              print.languages,
          })
        }
        options={choices.map((languages) => ({
          value: printLanguageValue(languages),
          label: printLanguageChoiceLabel(languages),
        }))}
        description={`Up to two, the first larger.${print.piece === 'tent' ? ' Both faces of a tent show both.' : ''}`}
      />
      <PrintCtaSelect words={printState.words} print={print} />
      {printState.words.isOwn && <PrintOwnWords words={printState.words} print={print} />}
      <PrintSaveWording wording={printState.wording} />
      <MoreOptions {...props} />
    </Step>
  )
}
