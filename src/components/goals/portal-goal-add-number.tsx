// The add sheet's number steps (copy deck M-6, M-7, M-10, M-14): the set
// sheet's number as the hero between − and +, with its unit under it ("Reception
// · private ratings in December"), and the subject's three suggestions in a
// panel when it has them; for the average, a box of tenths that starts empty,
// what it needs, and the one line the average step says. Everything they say is
// the add view's.
import { useId } from 'react'
import { GoalSetupPanel } from './goal-setup-parts'
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

/** M-10: a goal for one Portal or one group. */
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

/** M-6, M-14: the Property's average private rating. */
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
      <p className="text-sm text-muted-foreground">{PORTAL_SPOT_NOT_PERSON_LINE}</p>
    </div>
  )
}
