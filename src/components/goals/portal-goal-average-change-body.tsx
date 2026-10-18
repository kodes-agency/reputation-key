// The average's change sheet's form (PLAN PG-21; copy deck S-15, S-19, S-20,
// M-14): the month (a choice only when there are two), the box of tenths with
// its band and unit, what an average needs, "Add a note", the refusal and the
// footer. While the command is on its way nothing in it changes the level.
// Everything it says is the change view's
// (`portal-goal-average-change-view.ts`); it only draws it and hands each
// change up. The sheet owns the command (`portal-goal-average-change-sheet.tsx`).
import { DialogErrorBanner } from '#/components/forms/dialog-error-banner'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { Button } from '#/components/ui/button'
import { DialogCancel, DialogFooter } from '#/components/ui/dialog'
import { SegmentedControl } from '#/components/ui/segmented-control'
import type {
  PortalGoalAverageChangeEdit,
  PortalGoalAverageChangeModel,
} from './portal-goal-average-change-view'
import { PortalGoalNoteField } from './portal-goal-note-field'
import { PortalGoalNumberTile } from './portal-goal-number-tile'

type Props = Readonly<{
  model: PortalGoalAverageChangeModel
  /** A phone: the smaller figures. */
  small: boolean
  /** The change is on its way. */
  pending: boolean
  /** The last refusal of the primary, since the sheet opened. */
  error: unknown
  /** A refusal the sheet opened with (on the latest), said until the next press. */
  notice: unknown
  onChange: (edit: PortalGoalAverageChangeEdit) => void
  onSubmit: () => void
}>

export function PortalGoalAverageChangeBody({
  model,
  small,
  pending,
  error,
  notice,
  onChange,
  onSubmit,
}: Props) {
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!model.primary.disabled) onSubmit()
      }}
    >
      {model.months.length < 2 ? null : (
        <SegmentedControl
          touch
          aria-label="Month"
          value={model.month}
          onValueChange={(month) => onChange({ kind: 'month', month })}
          options={model.months}
          disabled={pending}
          className="self-center"
        />
      )}
      <PortalGoalNumberTile
        band={model.band}
        unit={model.unit}
        number={model.number}
        small={small}
        pending={pending}
        decimal
        onType={(text) => onChange({ kind: 'type', text })}
        onCommit={() => onChange({ kind: 'commit' })}
        onStep={(value) => onChange({ kind: 'number', value })}
        onFocusChange={() => undefined}
      />
      <p className="text-center text-sm text-muted-foreground">{model.status}</p>
      <PortalGoalNoteField
        note={model.note}
        pending={pending}
        onOpen={() => onChange({ kind: 'note_open' })}
        onType={(text) => onChange({ kind: 'note', text })}
      />
      {notice === null ? (
        <DialogErrorBanner error={error} />
      ) : (
        <FormErrorBanner error={notice} />
      )}
      <DialogFooter>
        <DialogCancel />
        <Button
          type="submit"
          disabled={model.primary.disabled}
          pending={pending}
          pendingLabel="Saving…"
          className="whitespace-normal"
        >
          {model.primary.label}
        </Button>
      </DialogFooter>
    </form>
  )
}
