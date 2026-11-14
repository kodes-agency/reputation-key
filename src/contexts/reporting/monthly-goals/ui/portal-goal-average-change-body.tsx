// Freeze the level while the change command is pending.

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
      className="flex flex-1 flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!model.primary.disabled) onSubmit()
      }}
    >
      {model.months.length < 2 ? null : (
        <SegmentedControl
          aria-label="Month"
          value={model.month}
          onValueChange={(month) => onChange({ kind: 'month', month })}
          options={model.months}
          disabled={pending}
          className="self-center"
        />
      )}
      <PortalGoalNumberTile
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
      <DialogFooter className="mt-auto">
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
