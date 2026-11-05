// Keep the goal snapshot from opening, even if background reads advance. Stale revision
// or month keys require a fresh read and reopening with the refusal preserved; a
// stopped goal closes the sheet.

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
