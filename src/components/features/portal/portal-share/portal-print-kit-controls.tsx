// What the manager chooses for a print, top to bottom as the share board draws
// it (spec 7.2): the style, the piece, the paper beside the languages, and the
// call to action. Every choice is a real control with a name: radio cards, a
// segmented radio, a select and radios. Each choice rewrites the whole choice,
// so the section above never holds a half-chosen print.

import { RectangleVertical, Triangle } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { FormSelectField } from '#/components/forms/form-select-field'
import { Label } from '#/components/ui/label'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import { SegmentedControl } from '#/components/ui/segmented-control'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import {
  PRINT_KIT_CALLS_TO_ACTION,
  PRINT_KIT_CALL_TO_ACTION_LABELS,
  PRINT_KIT_PAPERS,
  PRINT_KIT_STYLES,
  printKitLanguageChoices,
  type PrintKitCallToAction,
  type PrintKitChoice,
  type PrintKitPaper,
  type PrintKitPiece,
  type PrintKitStyle,
} from '#/shared/domain/portal-print-kit'
import {
  PRINT_KIT_PAPER_LABELS,
  PRINT_KIT_PIECE_FACTS,
  PRINT_KIT_STYLE_FACTS,
  printKitPaperNote,
} from '#/shared/domain/portal-print-kit-pieces'
import { PrintKitChoiceCard, PrintKitStyleThumbnail } from './print-kit-choice-card'
import { languageChoiceLabel } from './print-kit-state'

const PIECE_ICONS: Readonly<
  Record<PrintKitPiece, ComponentType<{ className?: string }>>
> = { table_tent: Triangle, counter_card: RectangleVertical }

/** The share board lists the card first: it is the piece most customers print. */
const PIECE_ORDER: readonly PrintKitPiece[] = ['counter_card', 'table_tent']

const PAPER_OPTIONS = PRINT_KIT_PAPERS.map((paper) => ({
  value: paper,
  label: PRINT_KIT_PAPER_LABELS[paper],
}))

type Props = Readonly<{
  view: PortalPrintKitView
  choice: PrintKitChoice
  onChoiceChange: (choice: PrintKitChoice) => void
}>

/** A heading for a group of choices, which names the group by its id. */
function GroupLabel({ id, children }: Readonly<{ id: string; children: ReactNode }>) {
  return (
    <p id={id} className="mb-2 text-sm font-medium">
      {children}
    </p>
  )
}

export function PortalPrintKitControls({ view, choice, onChoiceChange }: Props) {
  return (
    <>
      <StyleCards view={view} choice={choice} onChoiceChange={onChoiceChange} />
      <PieceCards choice={choice} onChoiceChange={onChoiceChange} />
      <PaperAndLanguages view={view} choice={choice} onChoiceChange={onChoiceChange} />
      <CallToAction choice={choice} onChoiceChange={onChoiceChange} />
    </>
  )
}

function StyleCards({ view, choice, onChoiceChange }: Props) {
  return (
    <div>
      <GroupLabel id="print-kit-style-label">Style</GroupLabel>
      <RadioGroup
        aria-labelledby="print-kit-style-label"
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        value={choice.style}
        onValueChange={(style) =>
          onChoiceChange({ ...choice, style: style as PrintKitStyle })
        }
      >
        {PRINT_KIT_STYLES.map((style) => (
          <PrintKitChoiceCard
            key={style}
            id={`print-kit-style-${style}`}
            value={style}
            title={PRINT_KIT_STYLE_FACTS[style].label}
            detail={PRINT_KIT_STYLE_FACTS[style].detail}
            art={<PrintKitStyleThumbnail style={style} look={view.look} />}
          />
        ))}
      </RadioGroup>
    </div>
  )
}

function PieceCards({ choice, onChoiceChange }: Omit<Props, 'view'>) {
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
        {PIECE_ORDER.map((piece) => {
          const Icon = PIECE_ICONS[piece]
          const facts = PRINT_KIT_PIECE_FACTS[choice.style][piece][choice.paper]
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
 * The paper beside the languages, with the line on what each paper makes under
 * both. The languages are a select, not radios: with three or four choices the
 * radios wrapped onto an orphan line on a phone.
 */
function PaperAndLanguages({ view, choice, onChoiceChange }: Props) {
  const languageChoices = printKitLanguageChoices(view.locales)
  return (
    <div
      className="grid items-end gap-x-6 gap-y-1.5"
      style={{ gridTemplateColumns: 'auto minmax(0, 1fr)' }}
    >
      <div className="flex flex-col">
        <GroupLabel id="print-kit-paper-label">Paper size</GroupLabel>
        <SegmentedControl
          aria-labelledby="print-kit-paper-label"
          aria-describedby="print-kit-paper-note"
          value={choice.paper}
          onValueChange={(paper) =>
            onChoiceChange({ ...choice, paper: paper as PrintKitPaper })
          }
          options={PAPER_OPTIONS}
          touch
          // As tall as the select beside it, so the two labels sit on one line.
          className="min-h-9"
        />
      </div>
      <FormSelectField
        id="print-kit-languages"
        label="Languages on the print"
        value={choice.languages.join('+')}
        onValueChange={(joined) =>
          onChoiceChange({
            ...choice,
            languages:
              languageChoices.find((languages) => languages.join('+') === joined) ??
              choice.languages,
          })
        }
        options={languageChoices.map((languages) => ({
          value: languages.join('+'),
          label: languageChoiceLabel(languages),
        }))}
      />
      <p
        id="print-kit-paper-note"
        className="col-span-2 text-[13px] text-pretty text-muted-foreground"
      >
        {printKitPaperNote(choice.style, choice.piece)}
      </p>
    </div>
  )
}

function CallToAction({ choice, onChoiceChange }: Omit<Props, 'view'>) {
  return (
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
          <div key={callToAction} className="flex items-center gap-2">
            <RadioGroupItem value={callToAction} id={`print-kit-cta-${callToAction}`} />
            <Label htmlFor={`print-kit-cta-${callToAction}`} className="font-normal">
              {PRINT_KIT_CALL_TO_ACTION_LABELS[callToAction]}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  )
}
