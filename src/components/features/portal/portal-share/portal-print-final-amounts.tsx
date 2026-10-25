// The last two steps of the final Print cards section (final design spec §11.4
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
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import {
  PRINT_FINAL_BACK_HELP,
  PRINT_FINAL_BACK_LABEL,
} from '#/shared/domain/portal-print-final-back-copy'
import { printFinalHasBack } from '#/shared/domain/portal-print-final-back'
import {
  PRINT_FINAL_SHOP_CROP_MARKS_HELP,
  PRINT_FINAL_SHOP_CROP_MARKS_LABEL,
} from '#/shared/domain/portal-print-final-shop-copy'
import {
  printFinalLanguageChoiceLabel,
  printFinalLanguageChoices,
  printFinalLanguageValue,
} from '#/shared/domain/portal-print-final-languages'
import { PRINT_FINAL_PER_SHEET } from '#/shared/domain/portal-print-final-offer'
import {
  PRINT_FINAL_PAPER_NAMES,
  PRINT_FINAL_PIECE_FACTS,
  printFinalSheetsLabel,
  printFinalSparesNote,
} from '#/shared/domain/portal-print-final-share'
import { Step } from './portal-print-final-choices'
import { PrintFinalCtaSelect } from './print-final-cta-select'
import { PrintFinalOwnWords } from './print-final-own-words'
import type { PrintFinalSharePrint } from './print-final-state'
import type { PrintFinalState } from './use-print-final'

type StepProps = Readonly<{
  final: PrintFinalState
  print: PrintFinalSharePrint
  view: PortalPrintKitView
}>

const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

function Spares({ final, print, quantity }: StepProps & Readonly<{ quantity: number }>) {
  const { spares, note } = printFinalSparesNote(quantity, print.perSheet)
  if (spares === 0) return <p className="text-xs text-muted-foreground">{note}</p>
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id="print-final-spares"
        checked={print.fillSpares}
        onCheckedChange={(checked) => final.change({ fillSpares: checked === true })}
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

export function PrintFinalHowManyStep(props: StepProps) {
  const { final, print } = props
  if (print.printer === 'print_shop') return null
  const { noun } = PRINT_FINAL_PIECE_FACTS[print.piece]
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
          value={final.choice.quantityText}
          onChange={(event) => final.change({ quantityText: event.target.value })}
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
                {printFinalSheetsLabel(final.count?.sheets ?? 1)}
              </strong>{' '}
              of {print.perSheet} · {PRINT_FINAL_PAPER_NAMES[print.paper]}
            </>
          )}
        </span>
      </div>
      {quantity !== null && <Spares {...props} quantity={quantity} />}
    </Step>
  )
}

function PerSheetSelect({ final, print }: StepProps) {
  const fits = PRINT_FINAL_PER_SHEET[print.piece][print.look][print.paper]
  const { noun } = PRINT_FINAL_PIECE_FACTS[print.piece]
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
      onValueChange={(value) => final.change({ perSheet: Number(value) })}
      options={options}
      className="max-w-xs"
    />
  )
}

/** The optional back page of a card: logo and property name on the back, for a holder seen from both sides. */
function BackPageOption({ final, print }: StepProps) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id="print-final-back"
        checked={print.backPage}
        onCheckedChange={(checked) => final.change({ backPage: checked === true })}
        aria-describedby="print-final-back-help"
        className="mt-0.5"
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor="print-final-back" className="font-normal">
          {PRINT_FINAL_BACK_LABEL}
        </Label>
        <p id="print-final-back-help" className="text-xs text-muted-foreground">
          {PRINT_FINAL_BACK_HELP}
        </p>
      </div>
    </div>
  )
}

/** A print shop's crop marks: a checkbox like the back page, off unless asked for, because most shops find the cut from the file itself. */
function CropMarksOption({ final, print }: StepProps) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id="print-final-crop-marks"
        checked={print.cropMarks}
        onCheckedChange={(checked) => final.change({ cropMarks: checked === true })}
        aria-describedby="print-final-crop-marks-help"
        className="mt-0.5"
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor="print-final-crop-marks" className="font-normal">
          {PRINT_FINAL_SHOP_CROP_MARKS_LABEL}
        </Label>
        <p id="print-final-crop-marks-help" className="text-xs text-muted-foreground">
          {PRINT_FINAL_SHOP_CROP_MARKS_HELP}
        </p>
      </div>
    </div>
  )
}

function MoreOptions(props: StepProps) {
  const { print } = props
  const { noun } = PRINT_FINAL_PIECE_FACTS[print.piece]
  // The office printer's sheets hold several pieces; a print shop's file is one page, which may have marks.
  const shop = print.printer === 'print_shop'
  const back = printFinalHasBack(print.piece)
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

export function PrintFinalWordsStep(props: StepProps) {
  const { final, print, view } = props
  const choices = printFinalLanguageChoices(view.locales)
  return (
    <Step title="Words">
      <FormSelectField
        id="print-final-languages"
        label="Languages"
        value={printFinalLanguageValue(print.languages)}
        onValueChange={(value) =>
          final.change({
            languages:
              choices.find((languages) => printFinalLanguageValue(languages) === value) ??
              print.languages,
          })
        }
        options={choices.map((languages) => ({
          value: printFinalLanguageValue(languages),
          label: printFinalLanguageChoiceLabel(languages),
        }))}
        description={`Up to two, the first larger.${print.piece === 'tent' ? ' Both faces of a tent show both.' : ''}`}
      />
      <PrintFinalCtaSelect words={final.words} print={print} />
      {final.words.isOwn && <PrintFinalOwnWords words={final.words} print={print} />}
      <MoreOptions {...props} />
    </Step>
  )
}
