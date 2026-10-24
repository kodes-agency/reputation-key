// The choices of a print that follow the style, as the share board draws them
// (round-3 spec-delta S7): the Size cards (outlines at one scale, with where each
// size goes), the Piece cards at that size, the Output radios for a card that has
// a print shop and an office sheet, and the switch for the property's name under
// the logo with its hint. Each choice rewrites the whole choice; the section's
// state settles what the new one makes impossible (a Mini tent, a second language
// on a Mini) when it reads the choice back.

import { RectangleVertical, Triangle } from 'lucide-react'
import type { ComponentType } from 'react'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import {
  PRINT_KIT_SIZES,
  type PrintKitChoice,
  type PrintKitOutput,
  type PrintKitPiece,
  type PrintKitSize,
} from '#/shared/domain/portal-print-kit'
import {
  PRINT_KIT_NAME_HINT,
  PRINT_KIT_SIZE_FACTS,
  printKitOutputLabel,
  printKitOutputsOf,
  printKitPieceCardFacts,
  printKitPiecesOf,
  printKitSizeNote,
  printKitTrimText,
} from '#/shared/domain/portal-print-kit-offer'
import { PrintKitChoiceCard, PrintKitSizeOutline } from './print-kit-choice-card'

type ChoiceProps = Readonly<{
  choice: PrintKitChoice
  onChoiceChange: (choice: PrintKitChoice) => void
}>

const PIECE_ICONS: Readonly<
  Record<PrintKitPiece, ComponentType<{ className?: string }>>
> = { table_tent: Triangle, counter_card: RectangleVertical }

/** A heading for a group of choices, which names the group by its id. */
function GroupLabel({ id, children }: Readonly<{ id: string; children: string }>) {
  return (
    <p id={id} className="mb-2 text-sm font-medium">
      {children}
    </p>
  )
}

/**
 * The sizes the section offers: three cards once more than Large is offered, and
 * nothing while Large is the only size, because a lone card is not a choice.
 */
export function SizeCards({
  choice,
  sizes,
  onChoiceChange,
}: ChoiceProps & Readonly<{ sizes: readonly PrintKitSize[] }>) {
  const offered = PRINT_KIT_SIZES.filter((size) => sizes.includes(size))
  if (offered.length < 2) return null
  return (
    <div>
      <GroupLabel id="print-kit-size-label">Size</GroupLabel>
      <RadioGroup
        aria-labelledby="print-kit-size-label"
        aria-describedby="print-kit-size-note"
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        value={choice.size}
        onValueChange={(size) =>
          onChoiceChange({ ...choice, size: size as PrintKitSize })
        }
      >
        {offered.map((size) => (
          <PrintKitChoiceCard
            key={size}
            id={`print-kit-size-${size}`}
            value={size}
            title={PRINT_KIT_SIZE_FACTS[size].label}
            qualifier={printKitTrimText(size, choice.paper)}
            detail={PRINT_KIT_SIZE_FACTS[size].where}
            art={<PrintKitSizeOutline size={size} paper={choice.paper} />}
          />
        ))}
      </RadioGroup>
      <p id="print-kit-size-note" className="mt-2 text-[13px] text-muted-foreground">
        {printKitSizeNote(choice.paper)}
      </p>
    </div>
  )
}

/**
 * The pieces the size comes in: the card first, the most printed. A size with one
 * piece (Mini) has no choice to make, so it shows none.
 */
export function PieceCards({ choice, onChoiceChange }: ChoiceProps) {
  const pieces = printKitPiecesOf(choice.size)
  if (pieces.length < 2) return null
  return (
    <div>
      <GroupLabel id="print-kit-piece-label">Piece</GroupLabel>
      <RadioGroup
        aria-labelledby="print-kit-piece-label"
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        value={choice.piece}
        onValueChange={(piece) =>
          onChoiceChange({ ...choice, piece: piece as PrintKitPiece })
        }
      >
        {pieces.map((piece) => {
          const Icon = PIECE_ICONS[piece]
          const facts = printKitPieceCardFacts(
            choice.style,
            piece,
            choice.paper,
            choice.size,
          )
          return (
            <PrintKitChoiceCard
              key={piece}
              id={`print-kit-piece-${piece}`}
              value={piece}
              title={facts.label}
              detail={facts.detail}
              art={<Icon className="size-5 shrink-0 text-muted-foreground" />}
            />
          )
        })}
      </RadioGroup>
    </div>
  )
}

/**
 * Who prints it, for a card that can go to a print shop or onto the manager's own
 * printer (an Immersive Large or Table card): "For my printer · 4 cards per
 * sheet". A print with one way to be printed shows no choice.
 */
export function OutputRadios({ choice, onChoiceChange }: ChoiceProps) {
  const outputs = printKitOutputsOf(choice)
  if (outputs.length < 2) return null
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">Output</legend>
      <RadioGroup
        aria-label="Output"
        value={choice.output}
        onValueChange={(output) =>
          onChoiceChange({ ...choice, output: output as PrintKitOutput })
        }
      >
        {outputs.map((output) => (
          <div key={output} className="flex items-center gap-2">
            <RadioGroupItem value={output} id={`print-kit-output-${output}`} />
            <Label htmlFor={`print-kit-output-${output}`} className="font-normal">
              {printKitOutputLabel(output, choice)}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  )
}

/**
 * The switch for the property's name under a logo on a Large or Table card. A
 * property with no logo prints its wordmark, which is the name, so the switch is
 * hidden for it; the hint says where the name is printed (D12).
 */
export function NameSwitch({
  hasLogo,
  choice,
  onChoiceChange,
}: ChoiceProps & Readonly<{ hasLogo: boolean }>) {
  if (!hasLogo) return null
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id="print-kit-name"
        className="mt-0.5"
        checked={choice.showPropertyName}
        aria-describedby="print-kit-name-hint"
        onCheckedChange={(checked) =>
          onChoiceChange({ ...choice, showPropertyName: checked === true })
        }
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor="print-kit-name" className="font-normal">
          Print the property name under the logo
        </Label>
        <p id="print-kit-name-hint" className="text-[13px] text-muted-foreground">
          {PRINT_KIT_NAME_HINT}
        </p>
      </div>
    </div>
  )
}
