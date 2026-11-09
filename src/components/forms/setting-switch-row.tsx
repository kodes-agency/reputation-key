// A boolean setting: the label, and its help, at the start of the row, the switch at
// the end.
//
// `commit` is required, and the row shows it as soon as the switch moves:
// - `immediate`: flipping the switch saves at once. The row says "Saving…" while the
//   save runs and "Saved" for a moment when it lands. `onCheckedChange` hands back the
//   save's promise (a rejection, or `false`, is a refusal: the caller's mutation has
//   reported it in a toast, and the row says nothing more). `pending` is for a row
//   whose switch must also wait while the save runs; the notification channels do not
//   pass it, because the switch has already moved and a second flip queues.
// - `deferred`: the switch is one field of a group that saves on its Save (or on the
//   wizard's last step). While its value differs from the saved one (`unsaved`) the
//   row says "Unsaved". The group's own button carries the pending state. A group
//   with no saved value yet (a wizard step) passes no `unsaved`.
//
// A Checkbox is not a setting: it stays for a statement the person agrees to
// (`ConsentCheckbox`) and for choosing several things from a list.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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

// What the save behind a flipped switch is doing, as the row says it. A row that saves
// as it is flipped hands its handler's promise to `track`: "Saving…" while it runs,
// "Saved" for a moment when it lands, nothing when it was refused (the caller has said
// so in a toast).
//
// A save is refused when its promise rejects or resolves `false`. Flips that overlap
// are one stretch of saving: the row settles when the last of them has, and says
// "Saved" only if that one landed.

/** How long "Saved" stays beside the switch. */
const SAVED_NOTICE_MS = 2500

type SaveStatus = 'idle' | 'saving' | 'saved'

type TrackSave = (result: unknown) => void

function useSaveStatus(): readonly [SaveStatus, TrackSave] {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const inFlight = useRef(0)
  const alive = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(hideTimer.current)
    }
  }, [])

  const track = useCallback<TrackSave>((result) => {
    if (!(result instanceof Promise)) return
    clearTimeout(hideTimer.current)
    inFlight.current += 1
    setStatus('saving')
    const settle = (landed: boolean) => {
      inFlight.current -= 1
      if (!alive.current || inFlight.current > 0) return
      setStatus(landed ? 'saved' : 'idle')
      if (landed) {
        hideTimer.current = setTimeout(() => setStatus('idle'), SAVED_NOTICE_MS)
      }
    }
    result.then(
      (value) => settle(value !== false),
      () => settle(false),
    )
  }, [])

  return [status, track]
}
