// Keep the goal snapshot from opening, even if background reads advance. Stale revision
// or month keys require a fresh read and reopening with the refusal preserved; a
// stopped goal closes the sheet.

import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type {
  PortalGoalChangeFacts,
  PortalGoalOfCard,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { useState } from 'react'
import { GoalSheetFrame } from '../../../../components/goals/goal-sheet-frame'
import { goalSheetNow } from '../../../../components/goals/goal-sheet-clock'
import { usePortalGoalChangeCommand } from './portal-goal-change-command'
import {
  portalGoalChangeSend,
  usePortalGoalChangeDraft,
} from './portal-goal-change-draft'
import type { PortalGoalSheetProps } from './portal-goal-sheet'
import { PortalGoalNoteField } from './portal-goal-note-field'
import { PortalGoalSheetBody } from './portal-goal-sheet-body'
import {
  changedChangeDraft,
  openingChangeDraft,
  portalGoalChangeModel,
  type PortalGoalChangeContext,
  type PortalGoalChangeEdit,
} from './portal-goal-sheet-change-view'

type Props = PortalGoalSheetProps &
  Readonly<{
    goal: PortalGoalOfCard
    change: PortalGoalChangeFacts
    measure: PortalGoalMeasure
  }>

export function PortalGoalChangeSheet(props: Props) {
  const { goal, change, facts } = props
  const [now] = useState(() => props.now ?? goalSheetNow())
  const context: PortalGoalChangeContext = { goal, change, facts, now }
  const { draft, edit } = usePortalGoalChangeDraft(
    () => openingChangeDraft(context, props.measure),
    (current, next: PortalGoalChangeEdit) => changedChangeDraft(current, next, context),
  )
  const model = portalGoalChangeModel(draft, context)
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
            const sent = portalGoalChangeSend(model)
            if (sent !== null) send(sent)
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
