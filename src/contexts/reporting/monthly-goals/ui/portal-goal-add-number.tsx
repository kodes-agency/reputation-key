import { useId } from 'react'
import { GoalSetupPanel } from '../../../../components/goals/goal-setup-parts'
import { PortalGoalChoices } from './portal-goal-choices'
import { PORTAL_SPOT_NOT_PERSON_LINE } from './portal-goal-copy'
import type { averageModel, numberModel } from './portal-goal-add-number-view'
import { PortalGoalNumberTile } from './portal-goal-number-tile'

type Box = Readonly<{
  /** A phone: the smaller figures. */
  small: boolean
  /** Set is on its way. */
  pending: boolean
  onType: (text: string) => void
  onCommit: () => void
  onStep: (to: number) => void
}>

/** A goal for one Portal or one group. */
export function PortalGoalAddNumber({
  model,
  ...box
}: Box & Readonly<{ model: ReturnType<typeof numberModel> }>) {
  const id = useId()
  return (
    <div className="flex flex-col gap-4">
      <PortalGoalNumberTile
        unit={model.unit}
        number={model.number}
        small={box.small}
        pending={box.pending}
        onType={box.onType}
        onCommit={box.onCommit}
        onStep={box.onStep}
        onFocusChange={() => undefined}
      />
      {model.choices === null ? null : (
        <GoalSetupPanel small={box.small}>
          <PortalGoalChoices
            choices={model.choices}
            chosen={model.chosen}
            idPrefix={`${id}-choice`}
            onChoose={box.onStep}
            disabled={box.pending}
          />
        </GoalSetupPanel>
      )}
    </div>
  )
}

/** The Property's average private rating. */
export function PortalGoalAddAverage({
  model,
  ...box
}: Box & Readonly<{ model: ReturnType<typeof averageModel> }>) {
  return (
    <div className="flex flex-col gap-4">
      <PortalGoalNumberTile
        unit={model.unit}
        number={model.number}
        small={box.small}
        pending={box.pending}
        decimal
        onType={box.onType}
        onCommit={box.onCommit}
        onStep={box.onStep}
        onFocusChange={() => undefined}
      />
      <p className="text-center text-sm text-muted-foreground">{model.status}</p>
      <p className="text-center text-sm text-muted-foreground">
        {PORTAL_SPOT_NOT_PERSON_LINE}
      </p>
    </div>
  )
}
