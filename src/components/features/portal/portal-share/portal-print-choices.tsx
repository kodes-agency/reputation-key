// The first three steps of the Print cards section (design spec
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
import type { PortalPrintKitView } from '#/contexts/portal/application/portal-management-contracts'
import { PRINT_KIT_PAPERS, type PrintKitPaper } from '#/shared/domain/portal-print-kit'
import {
  PRINT_LOOKS,
  type PrintLook,
  type PrintPiece,
  type PrintPrinter,
} from '#/shared/domain/portal-print'
import {
  PRINT_PAPER_NAMES,
  PRINT_PIECE_FACTS,
  PRINT_SHARE_PIECES,
  printLookFacts,
  printPieceCardDetail,
} from '#/shared/domain/portal-print-share'
import { printWhoLine, type PrintShopPrint } from '#/shared/domain/portal-print-shop-copy'
import { printHasShopFile } from '#/shared/domain/portal-print-shop'
import { PrintKitChoiceCard } from './print-kit-choice-card'
import { PrintShopNote } from './print-shop-note'
import { PrintOrientationControl } from './print-orientation-control'
import type { PrintSharePrint } from './print-state'
import { PrintLookThumbnail, PrintPieceThumbnail } from './print-thumbnails'
import type { PrintState } from './use-print'

type StepProps = Readonly<{
  printState: PrintState
  print: PrintSharePrint
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

const LOOK_TITLES: Readonly<Record<PrintLook, string>> = {
  paper: 'Paper',
  immersive: 'Immersive',
}

/** A piece's radio card: its picture over its name and line, the radio at the top end; a row on a phone. */
function PieceCard({
  piece,
  print,
  printState,
  view,
}: StepProps & Readonly<{ piece: PrintPiece }>) {
  const id = `print-final-piece-${piece}`
  const orientation = printState.choice.orientations[piece]
  const held = piece === 'tent' && print.printer === 'print_shop'
  return (
    <Label
      htmlFor={id}
      className="relative flex cursor-pointer items-center gap-3 rounded-lg border p-3 pr-8 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 sm:flex-col sm:items-start"
      // A print shop takes no tents: the card stays, dimmed, so the choice reads as held.
      style={held ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
    >
      <span className="flex h-12 w-11 shrink-0 items-end justify-center sm:w-auto">
        <PrintPieceThumbnail
          piece={piece}
          orientation={orientation}
          look={print.look}
          selected={piece === print.piece}
          colours={view.look}
        />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{PRINT_PIECE_FACTS[piece].title}</span>
        <span className="text-xs text-pretty text-muted-foreground">
          {printPieceCardDetail({ ...print, piece, orientation })}
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

export function PrintWhatStep(props: StepProps) {
  const { printState, print } = props
  return (
    <Step title="What are you printing?">
      <RadioGroup
        aria-label="What are you printing?"
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        value={print.piece}
        onValueChange={(piece) => printState.change({ piece: piece as PrintPiece })}
      >
        {PRINT_SHARE_PIECES.map((piece) => (
          <PieceCard key={piece} piece={piece} {...props} />
        ))}
      </RadioGroup>
      <div className="mt-1">
        <PrintOrientationControl
          piece={print.piece}
          orientation={print.orientation}
          paper={print.paper}
          onChange={(orientation) =>
            printState.chooseOrientation(print.piece, orientation)
          }
          idPrefix="print-final"
        />
      </div>
    </Step>
  )
}

export function PrintLookStep({ printState, print, view }: StepProps) {
  return (
    <Step title="Look">
      <RadioGroup
        aria-label="Look"
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        value={print.look}
        onValueChange={(look) => printState.change({ look: look as PrintLook })}
      >
        {PRINT_LOOKS.map((look) => (
          <PrintKitChoiceCard
            key={look}
            id={`print-final-look-${look}`}
            value={look}
            title={LOOK_TITLES[look]}
            detail={printLookFacts(look, print)}
            art={<PrintLookThumbnail look={look} colours={view.look} />}
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

/** What a print shop prints, where the manager chose one and the piece has a file (a tent has none). */
function shopPrintOf(print: PrintSharePrint): PrintShopPrint | null {
  if (print.printer !== 'print_shop' || !printHasShopFile(print.piece)) return null
  return { ...print, piece: print.piece }
}

export function PrintWhoStep({
  printState,
  print,
  countryCode,
}: StepProps & Readonly<{ countryCode: string | null }>) {
  const shopPrint = shopPrintOf(print)
  return (
    <Step title="Who prints it?">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          aria-label="Who prints it?"
          aria-describedby="print-final-stock"
          value={print.printer}
          onValueChange={(printer) => printState.choosePrinter(printer as PrintPrinter)}
          options={PRINTER_OPTIONS}
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
            onValueChange={(paper) =>
              printState.change({ paper: paper as PrintKitPaper })
            }
          >
            <SelectTrigger id="print-final-paper" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRINT_KIT_PAPERS.map((paper) => (
                <SelectItem key={paper} value={paper}>
                  {PRINT_PAPER_NAMES[paper]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p id="print-final-stock" className="text-xs text-pretty text-muted-foreground">
        {printWhoLine({ ...print, countryCode })}
      </p>
      {shopPrint !== null && printState.tile !== null && (
        <PrintShopNote print={shopPrint} tilePt={printState.tile.tilePt} />
      )}
    </Step>
  )
}
