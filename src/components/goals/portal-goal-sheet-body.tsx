// The sheet's form (copy deck S-2…S-11, S-15…S-22, G-16, U-S1…U-S3): the month
// (a choice only when there are two), the number as the hero with what it counts
// under it, what the number is (said politely as it changes, and quiet while the
// box has the focus, whose `aria-valuetext` says it then), the notes (said
// politely as they appear), the three suggestions when setting, in a panel with
// the ask-every-guest line when it counts private ratings, the row of links ("How
// we worked this out" and the other measure), the change's note, the refusal and
// the footer. It is drawn with the shared setup parts (`goal-setup-parts.tsx`).
// While the command is on its way nothing in it changes the number. Everything it
// says is the sheet views' (`portal-goal-sheet-view.ts`,
// `portal-goal-sheet-change-view.ts`); it only draws it and hands each change up.
import { useId, useState, type ReactNode } from 'react'
import { DialogErrorBanner } from '#/components/forms/dialog-error-banner'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { Button } from '#/components/ui/button'
import { DialogCancel, DialogFooter } from '#/components/ui/dialog'
import { SegmentedControl } from '#/components/ui/segmented-control'
import {
  GOAL_SETUP_LINK,
  GoalAside,
  GoalSetupLinks,
  GoalSetupPanel,
  GoalSetupStatusLine,
} from './goal-setup-parts'
import { PortalGoalChoices } from './portal-goal-choices'
import { PORTAL_ASK_EVERY_GUEST_LINE } from './portal-goal-copy'
import { PortalGoalNumberTile } from './portal-goal-number-tile'
import type {
  PortalGoalSheetBodyModel,
  PortalGoalSheetChange,
} from './portal-goal-sheet-view'
import { PortalGoalWorkedOut } from './portal-goal-worked-out'

type Props = Readonly<{
  model: PortalGoalSheetBodyModel
  /** A phone: the smaller figures. */
  small: boolean
  /** Set is on its way. */
  pending: boolean
  /** The last refusal of Set, since the sheet opened. */
  error: unknown
  onChange: (change: PortalGoalSheetChange) => void
  onSubmit: () => void
  /** The change's note, above the refusal; none when setting. */
  note?: ReactNode
  /**
   * A refusal the sheet opened with (F-1, on the latest), said until the next
   * press: the banner shows only refusals of presses made since it opened.
   */
  notice?: unknown
  /** The other measure is offered: not where the subject already holds a goal for it. */
  canSwitch?: boolean
}>

export function PortalGoalSheetBody({
  model,
  small,
  pending,
  error,
  onChange,
  onSubmit,
  note,
  notice = null,
  canSwitch = true,
}: Props) {
  const id = useId()
  const [boxFocused, setBoxFocused] = useState(false)
  const setNumber = (value: number) => onChange({ kind: 'number', value })
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
        unit={model.unit}
        number={model.number}
        small={small}
        pending={pending}
        onType={(text) => onChange({ kind: 'type', text })}
        onCommit={() => onChange({ kind: 'commit' })}
        onStep={setNumber}
        onFocusChange={setBoxFocused}
      />
      <div className="flex flex-col items-center">
        <GoalSetupStatusLine
          slot="portal-goal-status"
          parts={model.status}
          small={small}
          live={boxFocused ? 'off' : 'polite'}
          disabled={pending}
          onAction={setNumber}
        />
        {/* Always on the page and never quiet, so a note is said as it appears,
            the box's focus or not: its value text says only the number. Inside
            the status line's block, so an empty region adds no gap. */}
        <div data-slot="portal-goal-notes" aria-live="polite">
          {model.notes.map((note) => (
            <p key={note} className="mt-4 text-center text-sm">
              {note}
            </p>
          ))}
        </div>
      </div>
      {model.choices === null && !model.asksEveryGuest ? null : (
        // No label of its own: the suggestions are a group already named for a screen reader.
        <GoalSetupPanel small={small}>
          {model.choices === null ? null : (
            <PortalGoalChoices
              choices={model.choices}
              chosen={model.chosen}
              idPrefix={`${id}-choice`}
              onChoose={setNumber}
              disabled={pending}
            />
          )}
          {model.asksEveryGuest ? (
            <GoalAside>{PORTAL_ASK_EVERY_GUEST_LINE}</GoalAside>
          ) : null}
        </GoalSetupPanel>
      )}
      {model.offer === null && !canSwitch ? null : (
        <GoalSetupLinks sentence={model.counts} small={small}>
          {model.offer === null ? null : (
            <PortalGoalWorkedOut offer={model.offer} triggerClassName={GOAL_SETUP_LINK} />
          )}
          {model.offer !== null && canSwitch ? <span aria-hidden="true">·</span> : null}
          {canSwitch ? (
            <Button
              type="button"
              variant="link"
              size="inline"
              touch
              disabled={pending}
              onClick={() =>
                onChange({ kind: 'measure', measure: model.switchMeasure.measure })
              }
            >
              {model.switchMeasure.label}
            </Button>
          ) : null}
        </GoalSetupLinks>
      )}
      {note}
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
