// A boolean setting (UI consistency scan: FORM-08): the label, and its help, at the
// start of the row, the switch at the end. It was drawn five ways (the switch before
// its text, the label left with the switch pushed right, the label then the switch,
// a switch and an On/Off word in a table cell, and a Checkbox standing in for one),
// and none said when it saves.
//
// `commit` says it, and is required, and the row shows it as soon as the switch moves:
// - `immediate`: flipping the switch saves at once. The row says "Saving…" while the
//   save runs and "Saved" for a moment when it lands. `onCheckedChange` hands back the
//   save's promise (a rejection, or `false`, is a refusal: the caller's mutation has
//   reported it in a toast, decision 6, and the row says nothing more). `pending` is for
//   a row whose switch must also wait while the save runs; the notification channels
//   do not pass it, because the switch has already moved and a second flip queues.
// - `deferred`: the switch is one field of a group that saves on its Save (or on the
//   wizard's last step). While its value differs from the saved one (`unsaved`) the
//   row says "Unsaved", so a person does not leave believing the flip was kept. The
//   group's own button carries the pending state, so the row has no "Saving…" of its
//   own. A group with no saved value yet (a wizard step) passes no `unsaved`.
//
// A Checkbox is not a setting: it stays for a statement the person agrees to
// (`ConsentCheckbox`) and for choosing several things from a list.
import type { ReactNode } from 'react'
import { FieldDescription } from '#/components/ui/field'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { cn } from '#/lib/utils'
import { useSaveStatus, type SaveStatus } from './use-save-status'

type Props = Readonly<{
  id: string
  /** What the setting is, in words the person would use. It is the switch's name. */
  label: ReactNode
  /** A line under the label: what the setting does. */
  description?: ReactNode
  /** A line under that: where the value comes from, or why it cannot change ("Always on"). */
  note?: ReactNode
  checked: boolean
  /** An `immediate` row returns its save's promise, so the row can say how it went. */
  onCheckedChange: (checked: boolean) => void | Promise<unknown>
  /** When the change takes effect: see above. */
  commit: 'immediate' | 'deferred'
  /** The save is running and the switch waits for it (an `immediate` row only). */
  pending?: boolean
  /** The value differs from the saved one, so the group's Save has not kept it (a `deferred` row only). */
  unsaved?: boolean
  disabled?: boolean
  /**
   * The switch's name when it must say more than the label (the category a channel
   * belongs to). The visible label stays inside it.
   */
  accessibleName?: string
  /**
   * `row` is the setting on a page of its own. `cell` is the switch inside a table
   * or a list that already names it: the label is read but not drawn, and
   * `stateWords` print beside the switch.
   */
  layout?: 'row' | 'cell'
  /** The words for on and off, drawn beside the switch of a `cell`: ['On', 'Off']. */
  stateWords?: readonly [on: string, off: string]
  className?: string
}>

type Part = 'description' | 'note'

const idOf = (id: string, part: Part) => `${id}-${part}`

/** The ids of the lines under the label, which the switch names as its description. */
const describedByOf = (
  id: string,
  lines: Readonly<Record<Part, ReactNode>>,
): string | undefined => {
  const parts = (['description', 'note'] as const).filter((part) => lines[part])
  return parts.map((part) => idOf(id, part)).join(' ') || undefined
}

/** The label, and the lines under it. A `cell` reads the label and draws none of it. */
function RowText({
  id,
  label,
  description,
  note,
  cell,
}: Readonly<Pick<Props, 'id' | 'label' | 'description' | 'note'> & { cell: boolean }>) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', cell && 'contents')}>
      <Label htmlFor={id} className={cn('leading-snug', cell ? 'sr-only' : 'w-fit')}>
        {label}
      </Label>
      {description ? (
        <FieldDescription id={idOf(id, 'description')}>{description}</FieldDescription>
      ) : null}
      {note ? (
        <p id={idOf(id, 'note')} className="text-sm text-muted-foreground">
          {note}
        </p>
      ) : null}
    </div>
  )
}

type Phase = 'saving' | 'saved' | 'unsaved'

const PHASE_WORDS: Readonly<Record<Phase, string>> = {
  saving: 'Saving…',
  saved: 'Saved',
  unsaved: 'Unsaved',
}

/** What the row says about when this setting is kept, if it has anything to say. */
function phaseOf(
  props: Readonly<Pick<Props, 'commit' | 'pending' | 'unsaved'> & { status: SaveStatus }>,
): Phase | null {
  if (props.commit === 'deferred') return props.unsaved ? 'unsaved' : null
  if (props.pending || props.status === 'saving') return 'saving'
  return props.status === 'saved' ? 'saved' : null
}

/** What stands beside the switch: where it is in being kept, else the state in words. */
function RowStatus({
  phase,
  checked,
  stateWords,
}: Readonly<Pick<Props, 'checked' | 'stateWords'> & { phase: Phase | null }>) {
  if (phase) {
    return (
      <span role="status" className="text-sm text-muted-foreground">
        {PHASE_WORDS[phase]}
      </span>
    )
  }
  if (!stateWords) return null
  return (
    <span aria-hidden="true" className="text-sm text-muted-foreground">
      {checked ? stateWords[0] : stateWords[1]}
    </span>
  )
}

export function SettingSwitchRow({
  id,
  label,
  description,
  note,
  checked,
  onCheckedChange,
  commit,
  pending = false,
  unsaved = false,
  disabled = false,
  accessibleName,
  layout = 'row',
  stateWords,
  className,
}: Props) {
  const [status, trackSave] = useSaveStatus()
  const phase = phaseOf({ commit, pending, unsaved, status })
  const waiting = commit === 'immediate' && pending
  const cell = layout === 'cell'
  const change = (next: boolean) => {
    const result = onCheckedChange(next)
    if (commit === 'immediate') trackSave(result)
  }
  return (
    <div
      data-slot="setting-switch-row"
      data-commit={commit}
      data-layout={layout}
      data-disabled={disabled}
      className={cn(
        'group flex min-w-0 items-center gap-4 max-md:min-h-(--control-touch)',
        cell ? 'gap-2' : 'justify-between',
        className,
      )}
    >
      <RowText id={id} label={label} description={description} note={note} cell={cell} />
      <div className="flex shrink-0 items-center gap-2">
        <RowStatus phase={phase} checked={checked} stateWords={stateWords} />
        <Switch
          id={id}
          checked={checked}
          disabled={disabled || waiting}
          aria-label={accessibleName}
          aria-describedby={describedByOf(id, { description, note })}
          aria-busy={phase === 'saving' || undefined}
          onCheckedChange={change}
        />
      </div>
    </div>
  )
}
