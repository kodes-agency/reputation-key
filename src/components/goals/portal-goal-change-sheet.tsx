// The sheet that changes the Monthly portal goal (PLAN PG-14; copy deck S-1,
// S-15…S-23, F-1, F-2): "November, now" or "From Dec 1", the number box, what
// the number is, a note on the way it starts the month when it is behind, the
// other measure (from the next month only), and "Add a note". The primary
// sends "now" as a change of the running month and the months after it, and
// "from next month" as a revision; a toast says what was saved.
//
// It works from the goal as the sheet opened on it, never from a read that
// moved on under it. A refusal is said in the banner above the footer. When
// the sheet is behind the goal, the goal is read again and the sheet opens
// afresh on the latest, still saying why: someone changed the goal (F-1), the
// month a change now was for has ended (F-2: the latest then offers the month
// after), or the month a change from a coming month starts with has turned
// (F-4). A goal stopped a moment ago (F-5) leaves nothing to change: the sheet
// closes on the latest and a toast says why. Part of the sheet's chunk.
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type {
  PortalGoalChangeFacts,
  PortalGoalOfCard,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { useState } from 'react'
import { GoalSheetFrame } from './goal-sheet-frame'
import { usePortalGoalChangeCommand } from './portal-goal-change-command'
import type { PortalGoalSheetProps } from './portal-goal-sheet'
import { PortalGoalNoteField } from './portal-goal-note-field'
import { PortalGoalSheetBody } from './portal-goal-sheet-body'
import {
  changedChangeDraft,
  openingChangeDraft,
  portalGoalChangeModel,
  type PortalGoalChangeContext,
} from './portal-goal-sheet-change-view'

type Props = PortalGoalSheetProps &
  Readonly<{
    goal: PortalGoalOfCard
    change: PortalGoalChangeFacts
    measure: PortalGoalMeasure
  }>

export function PortalGoalChangeSheet(props: Props) {
  const { goal, change, facts } = props
  const [now] = useState(() => props.now ?? new Date())
  const context: PortalGoalChangeContext = { goal, change, facts, now }
  const [draft, setDraft] = useState(() => openingChangeDraft(context, props.measure))
  const model = portalGoalChangeModel(draft, context)
  const edit = (next: Parameters<typeof changedChangeDraft>[1]) =>
    setDraft((current) => changedChangeDraft(current, next, context))
  const { send, pending, error, notice } = usePortalGoalChangeCommand({
    commands: props.commands,
    propertyId: props.propertyId,
    change,
    markStale: props.commands.onSet,
    onSettled: props.onSettled,
    onBehind: props.onBehind,
    notice: props.notice,
  })
  return (
    <GoalSheetFrame
      open={props.open}
      onOpenChange={props.onOpenChange}
      busy={pending}
      marker="data-portal-goal-sheet"
      title={props.changeTitle ?? model.title}
      description={model.description}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      {(phone) => (
        <PortalGoalSheetBody
          model={model}
          small={phone}
          pending={pending}
          error={error}
          notice={notice}
          onChange={edit}
          canSwitch={props.canSwitch}
          onSubmit={() => {
            if (model.submission !== null && model.toast !== null) {
              send({ submission: model.submission, toast: model.toast })
            }
          }}
          note={
            <PortalGoalNoteField
              note={model.note}
              pending={pending}
              onOpen={() => edit({ kind: 'note_open' })}
              onType={(text) => edit({ kind: 'note', text })}
            />
          }
        />
      )}
    </GoalSheetFrame>
  )
}
