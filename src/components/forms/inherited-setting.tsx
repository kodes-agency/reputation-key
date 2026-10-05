// "Follow the parent, or set my own" (UI consistency scan: FORM-09). The Property's
// private-feedback target, a Property's quiet hours and a notification category each
// asked it with a different control (a Checkbox, a pair of buttons, a "Use my default
// here" button), different words and a different moment of saving, and none pointed at
// the setting it follows. This row is the one answer: what the place follows (a link to
// the owner, where there is a page for it) and what that is worth, whether the place has
// a value of its own, and one button that puts the inherited value back (or starts a
// value of its own).
//
// The row draws no editor. The value the place sets is the caller's field, beside it,
// which is enabled while `overridden` (the target's hours, the quiet hours' times).
//
// `commit` is required, as it is on `SettingSwitchRow`:
// - `immediate`: the buttons save at once. The caller reports a refusal in a toast, and
//   `pending` keeps the button busy while the request runs.
// - `deferred`: the buttons only change what the group will save; its Save and Reset
//   carry the rest, so the row has no pending state.
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'

type Props = Readonly<{
  /** Who owns the value that is followed: "the Organization target", "your quiet hours". Pass a link to put the owner one click away. */
  source: ReactNode
  /** What the followed value is worth, in words: "24 hours". Left out when the note says it. */
  value?: ReactNode
  /** This place has a value of its own. */
  overridden: boolean
  commit: 'immediate' | 'deferred'
  /** Put the inherited value back. */
  onInherit: () => void
  /** Start a value of its own. Left out where editing the value is what overrides it. */
  onOverride?: () => void
  /** The button that puts the inherited value back; "Use inherited value" unless the place has better words. */
  inheritLabel?: string
  inheritAccessibleName?: string
  overrideLabel?: string
  overrideAccessibleName?: string
  /** The save behind a button is running (an `immediate` row only). */
  pending?: boolean
  disabled?: boolean
  /** A line under the status: what the followed value means here. */
  note?: ReactNode
  /** The id the note takes, for a button that names it as its description. */
  noteId?: string
  /** The other commands of the row ("Make this my default"), before the one that undoes the override. */
  children?: ReactNode
  className?: string
}>

export function InheritedSetting({
  source,
  value,
  overridden,
  commit,
  onInherit,
  onOverride,
  inheritLabel = 'Use inherited value',
  inheritAccessibleName,
  overrideLabel = 'Override',
  overrideAccessibleName,
  pending = false,
  disabled = false,
  note,
  noteId,
  children,
  className,
}: Props) {
  const saving = commit === 'immediate' && pending
  const hasToggle = overridden || onOverride !== undefined
  return (
    <div
      data-slot="inherited-setting"
      data-state={overridden ? 'overridden' : 'inherited'}
      data-commit={commit}
      className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2', className)}
    >
      <p className="basis-full text-sm text-muted-foreground">
        {overridden ? (
          <>
            Set here instead of {source}
            {value ? <> ({value})</> : null}.
          </>
        ) : (
          <>
            Follows {source}
            {value ? <>, currently {value}</> : null}.
          </>
        )}
      </p>
      {note ? (
        <p id={noteId} className="basis-full text-sm text-muted-foreground">
          {note}
        </p>
      ) : null}
      {children || hasToggle ? (
        <div className="flex flex-wrap items-center gap-2">
          {children}
          {hasToggle ? (
            <Button
              type="button"
              variant={overridden ? 'ghost' : 'outline'}
              size="sm"
              pending={saving}
              disabled={disabled}
              aria-label={overridden ? inheritAccessibleName : overrideAccessibleName}
              onClick={overridden ? onInherit : onOverride}
            >
              {overridden ? inheritLabel : overrideLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
