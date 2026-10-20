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
import { useId, useRef, useState, type ReactNode } from 'react'
import { DialogErrorBanner } from '#/components/forms/dialog-error-banner'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { Button } from '#/components/ui/button'
import { DialogCancel, DialogFooter } from '#/components/ui/dialog'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { cn } from '#/lib/utils'
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

/** What the number is (S-5…S-7) and the notes on it (S-8), said politely as they change. */
function NumberLine({
  model,
  small,
  pending,
  quiet,
  onRestore,
}: Readonly<{
  model: PortalGoalSheetBodyModel
  small: boolean
  pending: boolean
  /** The box has the focus: its value text says the number, so the line is quiet. */
  quiet: boolean
  onRestore: (value: number) => void
}>) {
  return (
    <div className="flex flex-col items-center">
      <GoalSetupStatusLine
        slot="portal-goal-status"
        parts={model.status}
        small={small}
        stack={small}
        live={quiet ? 'off' : 'polite'}
        disabled={pending}
        onAction={onRestore}
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
  )
}

/**
 * U-S2: the suggestions as rows, and the asking line quoted under them. With no
 * suggestions (the first weeks, a change) the line stands alone, centred under the
 * number: a muted panel holding one line of 12 px read as an empty box.
 */
function ChoicesPanel({
  model,
  small,
  pending,
  onChoose,
}: Readonly<{
  model: PortalGoalSheetBodyModel
  small: boolean
  pending: boolean
  onChoose: (value: number) => void
}>) {
  const id = useId()
  if (model.choices === null) {
    return model.asksEveryGuest ? (
      <p className="text-center text-xs text-muted-foreground">
        {PORTAL_ASK_EVERY_GUEST_LINE}
      </p>
    ) : null
  }
  // No label of its own: the suggestions are a group already named for a screen reader.
  return (
    <GoalSetupPanel small={small}>
      <PortalGoalChoices
        choices={model.choices}
        chosen={model.chosen}
        idPrefix={`${id}-choice`}
        onChoose={onChoose}
        disabled={pending}
      />
      {model.asksEveryGuest ? <GoalAside>{PORTAL_ASK_EVERY_GUEST_LINE}</GoalAside> : null}
    </GoalSetupPanel>
  )
}

/** U-S3: how the goal counts, then how the number was worked out and the other measure. */
function LinksRow({
  model,
  small,
  pending,
  canSwitch,
  onSwitch,
}: Readonly<{
  model: PortalGoalSheetBodyModel
  small: boolean
  pending: boolean
  canSwitch: boolean
  onSwitch: () => void
}>) {
  const { offer } = model
  if (offer === null && !canSwitch) return null
  return (
    <GoalSetupLinks sentence={model.counts} small={small}>
      {offer === null ? null : (
        <PortalGoalWorkedOut offer={offer} triggerClassName={GOAL_SETUP_LINK} />
      )}
      {offer !== null && canSwitch ? <span aria-hidden="true">·</span> : null}
      {canSwitch ? (
        <Button
          type="button"
          variant="link"
          size="inline"
          touch
          // One size and weight with "How we worked this out" beside it.
          className={cn('font-normal', small && 'text-xs')}
          disabled={pending}
          onClick={onSwitch}
        >
          {model.switchMeasure.label}
        </Button>
      ) : null}
    </GoalSetupLinks>
  )
}

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
  const [boxFocused, setBoxFocused] = useState(false)
  const boxRef = useRef<HTMLInputElement>(null)
  const setNumber = (value: number) => onChange({ kind: 'number', value })
  // The way back goes once it is used: the focus moves to the number first, which
  // then says the number (the status line is quiet while it has the focus), so
  // the focus is not lost and the line is not said twice.
  const restore = (value: number) => {
    boxRef.current?.focus()
    setNumber(value)
  }
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
          touch
          aria-label="Month"
          value={model.month}
          onValueChange={(month) => onChange({ kind: 'month', month })}
          options={model.months}
          disabled={pending}
          className="self-center"
        />
      )}
      {/* One block, as Google's headline is: the line sits close under the number's. */}
      <div className="flex flex-col">
        <PortalGoalNumberTile
          unit={model.unit}
          number={model.number}
          small={small}
          pending={pending}
          boxRef={boxRef}
          onType={(text) => onChange({ kind: 'type', text })}
          onCommit={() => onChange({ kind: 'commit' })}
          onStep={setNumber}
          onFocusChange={setBoxFocused}
        />
        <NumberLine
          model={model}
          small={small}
          pending={pending}
          quiet={boxFocused}
          onRestore={restore}
        />
      </div>
      <ChoicesPanel model={model} small={small} pending={pending} onChoose={setNumber} />
      <LinksRow
        model={model}
        small={small}
        pending={pending}
        canSwitch={canSwitch}
        onSwitch={() =>
          onChange({ kind: 'measure', measure: model.switchMeasure.measure })
        }
      />
      {note}
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
