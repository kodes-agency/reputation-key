// What the manager chooses for a print, top to bottom as the share board draws
// it (spec 7.2, round-3 S7): the style, the size, the piece at that size, the
// output, the paper beside the languages, the name under the logo and the call to
// action. Every choice is a real control with a name: radio cards, a segmented
// radio, a select, a checkbox and radios. Each choice rewrites the whole choice,
// so the section above never holds a half-chosen print; the size's own choices
// are `portal-print-kit-size-controls.tsx`.

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
  defaultPrintKitOutput,
  printKitLanguageChoices,
  type PrintKitCallToAction,
  type PrintKitChoice,
  type PrintKitPaper,
  type PrintKitSize,
  type PrintKitStyle,
} from '#/shared/domain/portal-print-kit'
import {
  printKitLanguageChoicesOf,
  printKitSizedPaperNote,
} from '#/shared/domain/portal-print-kit-offer'
import {
  PRINT_KIT_PAPER_LABELS,
  PRINT_KIT_STYLE_FACTS,
  printKitPaperNote,
} from '#/shared/domain/portal-print-kit-pieces'
import {
  GroupLabel,
  NameSwitch,
  OutputRadios,
  PieceCards,
  SizeCards,
} from './portal-print-kit-size-controls'
import { PrintKitChoiceCard, PrintKitStyleThumbnail } from './print-kit-choice-card'
import { languageChoiceLabel } from './print-kit-state'

const PAPER_OPTIONS = PRINT_KIT_PAPERS.map((paper) => ({
  value: paper,
  label: PRINT_KIT_PAPER_LABELS[paper],
}))

type Props = Readonly<{
  view: PortalPrintKitView
  choice: PrintKitChoice
  onChoiceChange: (choice: PrintKitChoice) => void
}>

type ControlsProps = Props &
  Readonly<{
    /** The sizes offered: `PRINT_KIT_SELECTABLE_SIZES` unless a story shows the hidden ones. */
    sizes: readonly PrintKitSize[]
  }>

export function PortalPrintKitControls({
  view,
  choice,
  sizes,
  onChoiceChange,
}: ControlsProps) {
  return (
    <>
      <StyleCards view={view} choice={choice} onChoiceChange={onChoiceChange} />
      <SizeCards choice={choice} sizes={sizes} onChoiceChange={onChoiceChange} />
      <PieceCards choice={choice} onChoiceChange={onChoiceChange} />
      <OutputRadios choice={choice} onChoiceChange={onChoiceChange} />
      <PaperAndLanguages view={view} choice={choice} onChoiceChange={onChoiceChange} />
      <NameSwitch
        hasLogo={view.look.logoUrl !== null}
        choice={choice}
        onChoiceChange={onChoiceChange}
      />
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
          // Each style starts on its own output: Immersive to a print shop, Paper on the manager's printer.
          onChoiceChange({
            ...choice,
            style: style as PrintKitStyle,
            output: defaultPrintKitOutput(style as PrintKitStyle),
          })
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

/**
 * The paper beside the languages, with the line on what each paper makes under
 * both. The languages are a select, not radios: with three or four choices the
 * radios wrapped onto an orphan line on a phone.
 */
function PaperAndLanguages({ view, choice, onChoiceChange }: Props) {
  const languageChoices = printKitLanguageChoicesOf(
    printKitLanguageChoices(view.locales),
    choice.size,
  )
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
        {printKitSizedPaperNote(choice.piece, choice.size) ??
          printKitPaperNote(choice.style, choice.piece)}
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
