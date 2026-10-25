// The first three steps of the final Print cards section (final design spec
// §11.1 to §11.3, the boards share-desktop-light and share-phone): what is being
// printed (three radio cards, each piece drawn in its own current orientation,
// and the Orientation control under them), the look with its facts, and who
// prints it with the country's paper and the one stock line. Every choice is a
// real control with a name.

import { Printer, Store } from 'lucide-react'
import type { ReactNode } from 'react'
import { Label } from '#/components/ui/label'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import { SegmentedControl } from '#/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { PRINT_KIT_PAPERS, type PrintKitPaper } from '#/shared/domain/portal-print-kit'
import {
  PRINT_FINAL_LOOKS,
  type PrintFinalLook,
  type PrintFinalPiece,
  type PrintFinalPrinter,
} from '#/shared/domain/portal-print-final'
import {
  PRINT_FINAL_PAPER_NAMES,
  PRINT_FINAL_PIECE_FACTS,
  PRINT_FINAL_SHARE_PIECES,
  printFinalLookFacts,
  printFinalPieceCardDetail,
  printFinalStockLine,
} from '#/shared/domain/portal-print-final-share'
import { PrintKitChoiceCard } from './print-kit-choice-card'
import { PrintFinalOrientationControl } from './print-final-orientation-control'
import type { PrintFinalSharePrint } from './print-final-state'
import {
  PrintFinalLookThumbnail,
  PrintFinalPieceThumbnail,
} from './print-final-thumbnails'
import type { PrintFinalState } from './use-print-final'

type StepProps = Readonly<{
  final: PrintFinalState
  print: PrintFinalSharePrint
  view: PortalPrintKitView
}>

/** A step's heading, as the boards set it: a legend over its controls. */
export function Step({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  )
}

const LOOK_TITLES: Readonly<Record<PrintFinalLook, string>> = {
  paper: 'Paper',
  immersive: 'Immersive',
}

/** A piece's radio card: its picture over its name and line, the radio at the top end; a row on a phone. */
function PieceCard({
  piece,
  print,
  final,
  view,
}: StepProps & Readonly<{ piece: PrintFinalPiece }>) {
  const id = `print-final-piece-${piece}`
  const orientation = final.choice.orientations[piece]
  const held = piece === 'tent' && print.printer === 'print_shop'
  return (
    <Label
      htmlFor={id}
      className="relative flex cursor-pointer items-center gap-3 rounded-lg border p-3 pr-8 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 sm:flex-col sm:items-start"
      // A print shop takes no tents: the card stays, dimmed, so the choice reads as held.
      style={held ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
    >
      <span className="flex h-12 w-11 shrink-0 items-end justify-center sm:w-auto">
        <PrintFinalPieceThumbnail
          piece={piece}
          orientation={orientation}
          look={print.look}
          selected={piece === print.piece}
          colours={view.look}
        />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">
          {PRINT_FINAL_PIECE_FACTS[piece].title}
        </span>
        <span className="text-xs text-pretty text-muted-foreground">
          {printFinalPieceCardDetail({ ...print, piece, orientation })}
        </span>
      </span>
      <RadioGroupItem
        value={piece}
        id={id}
        disabled={held}
        className="absolute top-3 right-3"
      />
    </Label>
  )
}

export function PrintFinalWhatStep(props: StepProps) {
  const { final, print } = props
  return (
    <Step title="What are you printing?">
      <RadioGroup
        aria-label="What are you printing?"
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        value={print.piece}
        onValueChange={(piece) => final.change({ piece: piece as PrintFinalPiece })}
      >
        {PRINT_FINAL_SHARE_PIECES.map((piece) => (
          <PieceCard key={piece} piece={piece} {...props} />
        ))}
      </RadioGroup>
      <div className="mt-1">
        <PrintFinalOrientationControl
          piece={print.piece}
          orientation={print.orientation}
          paper={print.paper}
          onChange={(orientation) => final.chooseOrientation(print.piece, orientation)}
          idPrefix="print-final"
        />
      </div>
    </Step>
  )
}

export function PrintFinalLookStep({ final, print, view }: StepProps) {
  return (
    <Step title="Look">
      <RadioGroup
        aria-label="Look"
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        value={print.look}
        onValueChange={(look) => final.change({ look: look as PrintFinalLook })}
      >
        {PRINT_FINAL_LOOKS.map((look) => (
          <PrintKitChoiceCard
            key={look}
            id={`print-final-look-${look}`}
            value={look}
            title={LOOK_TITLES[look]}
            detail={printFinalLookFacts(look, print)}
            art={<PrintFinalLookThumbnail look={look} colours={view.look} />}
          />
        ))}
      </RadioGroup>
    </Step>
  )
}

const PRINTER_OPTIONS = [
  {
    value: 'my_printer',
    label: 'My printer',
    icon: <Printer aria-hidden="true" className="size-3.5" />,
  },
  {
    value: 'print_shop',
    label: 'A print shop',
    icon: <Store aria-hidden="true" className="size-3.5" />,
  },
] as const

export function PrintFinalWhoStep({
  final,
  print,
  countryCode,
}: StepProps & Readonly<{ countryCode: string | null }>) {
  return (
    <Step title="Who prints it?">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          aria-label="Who prints it?"
          aria-describedby="print-final-stock"
          value={print.printer}
          onValueChange={(printer) => final.choosePrinter(printer as PrintFinalPrinter)}
          options={PRINTER_OPTIONS}
          touch
        />
        <div className="flex items-center gap-2">
          <Label
            htmlFor="print-final-paper"
            className="font-normal text-muted-foreground"
          >
            Paper
          </Label>
          <Select
            value={print.paper}
            onValueChange={(paper) => final.change({ paper: paper as PrintKitPaper })}
          >
            <SelectTrigger id="print-final-paper" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRINT_KIT_PAPERS.map((paper) => (
                <SelectItem key={paper} value={paper}>
                  {PRINT_FINAL_PAPER_NAMES[paper]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p id="print-final-stock" className="text-xs text-pretty text-muted-foreground">
        {printFinalStockLine({ ...print, countryCode })}
      </p>
    </Step>
  )
}
