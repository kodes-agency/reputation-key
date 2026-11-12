// The call-to-action select of the Print cards section (design spec
// §5.5 and §11.5; the boards share-desktop-light, share-phone frame 3 and
// share-words-states panels 4, 13 and 14). Each wording sits on two lines,
// headline over its sub-line, checked against the chosen print by the planner: a
// wording the print would refuse is greyed and says why, a print no wording fits
// says so once, and "Write your own…" stays open under a divider. A picked
// wording that a later change made too long, or that a language added to the
// print holds back, stays picked: the select turns red and says why. On a phone
// the menu is a bottom sheet.

import { Ban, Info, Pencil } from 'lucide-react'
import { useId, useState } from 'react'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '#/components/ui/sheet'
import { useIsBelowLarge } from '#/components/hooks/use-mobile'
import { PRINT_COPY, type PrintCallToAction } from '#/shared/domain/portal-print-copy'
import { PRINT_CALL_TO_ACTION_LABELS } from '#/shared/domain/portal-print-languages'
import {
  printCheckedAgainst,
  printMenuReason,
  printNoWordingNote,
  printTwoLanguagesHint,
} from '#/shared/domain/portal-print-words-copy'
import type { PrintMenuRow } from '#/shared/domain/portal-print-words-fit'
import type { PrintSharePrint } from './print-state'
import type { PrintWordsState } from './use-print-words'

/** The menu's last option, which is no wording. */
const OWN = 'own'

/** The select's trigger (the phone's button): where focus goes when "Save wording" goes. One is on the page. */
export const PRINT_CTA_TRIGGER_ID = 'print-cta'

type Props = Readonly<{ words: PrintWordsState; print: PrintSharePrint }>

/** A wording on two lines, and why it is greyed under it. */
function WordingLines({
  preset,
  reason,
}: Readonly<{ preset: PrintCallToAction; reason: string | null }>) {
  const { headline, subline } = PRINT_COPY.en[preset]
  return (
    <span className="flex min-w-0 flex-col items-start gap-px text-left">
      <span
        className={reason === null ? 'font-medium' : 'font-medium text-muted-foreground'}
      >
        {headline}
      </span>
      <span className="text-xs text-muted-foreground">{subline}</span>
      {reason !== null && (
        <span className="mt-0.5 flex items-start gap-1.5 text-xs text-warn">
          <Info aria-hidden="true" className="mt-px size-3.5 text-warn" />
          {reason}
        </span>
      )}
    </span>
  )
}

function OwnLines() {
  return (
    <span className="flex min-w-0 flex-col items-start gap-px text-left">
      <span className="font-medium">Write your own…</span>
      <span className="text-xs text-muted-foreground">
        Starts from the wording above, in every language you print
      </span>
    </span>
  )
}

/** The note at the top of a menu no wording fits. */
function NoWordingNote({ print }: Readonly<{ print: PrintSharePrint }>) {
  return (
    <Alert variant="warning" className="mx-2 mb-2 w-auto py-2">
      <AlertDescription className="text-xs text-foreground">
        {printNoWordingNote(print, print.paper, print.languages)}
      </AlertDescription>
    </Alert>
  )
}

const reasonOf = (row: PrintMenuRow, props: Props, none: boolean) =>
  none ? null : printMenuReason(row, props.print, props.print.languages)

function DesktopMenu(
  props: Props & Readonly<{ triggerId: string; describedBy?: string }>,
) {
  const { words, print } = props
  return (
    <Select
      value={words.isOwn ? OWN : print.callToAction}
      onValueChange={(value) =>
        value === OWN ? words.writeOwn() : words.pick(value as PrintCallToAction)
      }
    >
      <SelectTrigger
        id={props.triggerId}
        className="w-full"
        aria-invalid={words.pickedProblem !== null}
        aria-describedby={props.describedBy}
      >
        <SelectValue>
          {words.isOwn ? (
            <>
              <Pencil aria-hidden="true" /> Your own words
            </>
          ) : (
            PRINT_CALL_TO_ACTION_LABELS[print.callToAction]
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectGroup>
          <SelectLabel className="text-[11px] font-semibold tracking-wide uppercase">
            Call to action · {printCheckedAgainst(print, print.paper, print.languages)}
          </SelectLabel>
          {words.noWordingFits && <NoWordingNote print={print} />}
          {words.menu.map((row) => (
            <SelectItem
              key={row.preset}
              value={row.preset}
              disabled={row.state !== 'fits'}
              className="items-start"
              // A greyed wording keeps its reason legible: its headline is muted, not the whole row.
              style={{ opacity: 1 }}
            >
              <WordingLines
                preset={row.preset}
                reason={reasonOf(row, props, words.noWordingFits)}
              />
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectSeparator />
        <SelectItem value={OWN} className="items-start">
          <Pencil aria-hidden="true" className="mt-0.5" />
          <OwnLines />
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

/** The phone's menu: a bottom sheet titled "Call to action", the print it was checked against under the title. */
function PhoneMenu(props: Props & Readonly<{ triggerId: string; describedBy?: string }>) {
  const { words, print } = props
  const [open, setOpen] = useState(false)
  const choose = (value: string) => {
    if (value === OWN) words.writeOwn()
    else words.pick(value as PrintCallToAction)
    setOpen(false)
  }
  return (
    <>
      <Button
        id={props.triggerId}
        type="button"
        variant="outline"
        className="w-full justify-start font-normal"
        aria-haspopup="dialog"
        aria-invalid={words.pickedProblem !== null}
        aria-describedby={props.describedBy}
        onClick={() => setOpen(true)}
      >
        {words.isOwn ? (
          <>
            <Pencil aria-hidden="true" /> Your own words
          </>
        ) : (
          <span className="truncate">
            {PRINT_CALL_TO_ACTION_LABELS[print.callToAction]}
          </span>
        )}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="gap-3 rounded-t-xl px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <span aria-hidden="true" className="mx-auto h-1 w-9 rounded-full bg-border" />
          <div className="flex flex-col gap-0.5">
            <SheetTitle>Call to action</SheetTitle>
            <SheetDescription className="text-xs">
              Checked against {printCheckedAgainst(print, print.paper, print.languages)}
            </SheetDescription>
          </div>
          {words.noWordingFits && <NoWordingNote print={print} />}
          <RadioGroup
            aria-label="Call to action"
            value={words.isOwn ? OWN : print.callToAction}
            onValueChange={choose}
            className="gap-1"
          >
            {words.menu.map((row) => (
              <Label
                key={row.preset}
                className="flex min-h-11 items-start gap-3 rounded-md px-2 py-2 font-normal has-[[data-state=checked]]:bg-primary/5"
              >
                <RadioGroupItem
                  value={row.preset}
                  disabled={row.state !== 'fits'}
                  className="mt-1"
                />
                <WordingLines
                  preset={row.preset}
                  reason={reasonOf(row, props, words.noWordingFits)}
                />
              </Label>
            ))}
            <div aria-hidden="true" className="my-1 h-px bg-border" />
            <Label className="flex min-h-11 items-start gap-3 rounded-md px-2 py-2 font-normal">
              <RadioGroupItem value={OWN} className="mt-1" />
              <OwnLines />
            </Label>
          </RadioGroup>
        </SheetContent>
      </Sheet>
    </>
  )
}

/** "Started from ‘How did we do?’ · Back to that wording", under the select while the words are the manager's own. */
function StartedFrom({ words, print }: Props) {
  const [first] = print.languages
  return (
    <p className="text-xs text-muted-foreground">
      Started from “{PRINT_COPY.en[print.callToAction].headline}” ·{' '}
      <Button
        type="button"
        variant="link"
        className="h-auto p-0 text-xs underline"
        onClick={() => words.pick(print.callToAction)}
      >
        Back to that wording
      </Button>
      {first !== undefined &&
        print.languages.length > 1 &&
        ` · ${printTwoLanguagesHint(first)}`}
    </p>
  )
}

export function PrintCtaSelect(props: Props) {
  const { words } = props
  const phone = useIsBelowLarge()
  const id = useId()
  const triggerId = PRINT_CTA_TRIGGER_ID
  const whyId = `${id}-why`
  const problem = words.pickedProblem
  const Menu = phone ? PhoneMenu : DesktopMenu
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <Label htmlFor={triggerId} className="font-normal text-muted-foreground">
        Call to action
      </Label>
      <Menu
        {...props}
        triggerId={triggerId}
        describedBy={problem === null ? undefined : whyId}
      />
      {words.isOwn && <StartedFrom {...props} />}
      {problem !== null && (
        <p
          id={whyId}
          role="alert"
          className="flex items-start gap-1.5 text-xs text-negative"
        >
          <Ban aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>
            {problem.reason}
            <span className="block text-muted-foreground">{problem.help}</span>
          </span>
        </p>
      )}
    </div>
  )
}
