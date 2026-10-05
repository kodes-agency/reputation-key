// A boolean setting (UI consistency scan: FORM-08): the label, and its help, at the
// start of the row, the switch at the end. It was drawn five ways (the switch before
// its text, the label left with the switch pushed right, the label then the switch,
// a switch and an On/Off word in a table cell, and a Checkbox standing in for one),
// and none said when it saves.
//
// `commit` says it, and is required:
// - `immediate`: flipping the switch saves at once. The caller's mutation reports the
//   refusal in a toast (decision 6), and while it runs the row says "Saving…" and the
//   switch waits (`pending`). A row that saves optimistically (the notification
//   channels) passes no `pending`: the switch has already moved.
// - `deferred`: the switch is one field of a group that saves on its Save (or on the
//   wizard's last step). The group's own button carries the pending state, so the row
//   has no status of its own.
//
// A Checkbox is not a setting: it stays for a statement the person agrees to
// (`ConsentCheckbox`) and for choosing several things from a list.
import type { ReactNode } from 'react'
import { FieldDescription } from '#/components/ui/field'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { cn } from '#/lib/utils'

type Props = Readonly<{
  id: string
  /** What the setting is, in words the person would use. It is the switch's name. */
  label: ReactNode
  /** A line under the label: what the setting does. */
  description?: ReactNode
  /** A line under that: where the value comes from, or why it cannot change ("Always on"). */
  note?: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** When the change takes effect: see above. */
  commit: 'immediate' | 'deferred'
  /** The save is running (an `immediate` row only). */
  pending?: boolean
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

/** What stands beside the switch: "Saving…" while a request runs, else the state in words. */
function RowStatus({
  saving,
  checked,
  stateWords,
}: Readonly<Pick<Props, 'checked' | 'stateWords'> & { saving: boolean }>) {
  if (saving) {
    return (
      <span role="status" className="text-sm text-muted-foreground">
        Saving…
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
  disabled = false,
  accessibleName,
  layout = 'row',
  stateWords,
  className,
}: Props) {
  const saving = commit === 'immediate' && pending
  const cell = layout === 'cell'
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
        <RowStatus saving={saving} checked={checked} stateWords={stateWords} />
        <Switch
          id={id}
          checked={checked}
          disabled={disabled || saving}
          aria-label={accessibleName}
          aria-describedby={describedByOf(id, { description, note })}
          aria-busy={saving || undefined}
          onCheckedChange={onCheckedChange}
        />
      </div>
    </div>
  )
}
