// The plans of "Pick a plan" as radio cards (round 2, R2-6 and R2-7): "Your plan"
// first, across the row, when a goal is being changed, then Cautious,
// Recommended and Ambitious. Each card says the number Google is to show, the
// pace, the planned quality and the reviews it takes, and when it is expected;
// one more than a year away at its own pace says so ("More than a year"), the
// only label a card wears. While "Build your own" is the plan no card is checked. A card's radio is named
// by its plan and number ("Recommended 4.0 on Google") and described by the
// rest; the label is stretched over the card, so any of it picks the plan.
import { useId } from 'react'
import { Label } from '#/components/ui/label'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import { StatusBadge } from '#/components/ui/status-badge'
import { cn } from '#/lib/utils'
import { OPTION, OPTION_LABEL, QUIET } from './rating-goal-option'
import type { PlanCard, PlanCardKey } from './rating-goal-plan-view'
import { RatingGoalWholeDates } from './rating-goal-whole-dates'

type Props = Readonly<{
  cards: readonly PlanCard[]
  /** Null while "Build your own" is the plan. */
  checked: PlanCardKey | null
  onPick: (key: PlanCardKey) => void
  /** The quality every plan assumes describes the group. */
  describedBy: string
}>

export function RatingGoalPlanCards({ cards, checked, onPick, describedBy }: Props) {
  const id = useId()
  return (
    <RadioGroup
      aria-label="Plans"
      aria-describedby={describedBy}
      value={checked ?? ''}
      onValueChange={(value) => {
        const card = cards.find((each) => each.key === value)
        if (card !== undefined) onPick(card.key)
      }}
      className="sm:grid-cols-3"
    >
      {cards.map((card) => {
        const itemId = `${id}-${card.key}`
        return (
          <div
            key={card.key}
            data-plan={card.key}
            className={cn(OPTION, card.key === 'current' && 'sm:col-span-3')}
          >
            <RadioGroupItem
              value={card.key}
              id={itemId}
              aria-describedby={`${itemId}-detail`}
              className="mt-0.5"
            />
            <div className="flex flex-col gap-1">
              {/* The name is the plan and its number; the rest describes it. */}
              <Label
                htmlFor={itemId}
                className={`${OPTION_LABEL} flex-col items-start gap-1`}
              >
                <span className="text-sm font-medium">{card.name}</span>{' '}
                <span className="flex items-baseline gap-1.5">
                  <span className="text-2xl leading-none font-semibold tabular-nums">
                    {card.target}
                  </span>{' '}
                  <span className={QUIET}>on Google</span>
                </span>
              </Label>
              <p id={`${itemId}-detail`} className="flex flex-col items-start gap-1">
                <span className="text-sm tabular-nums">{card.line}</span>{' '}
                {card.forecastText === null ? null : (
                  <span className={QUIET}>
                    <RatingGoalWholeDates text={card.forecastText} />
                  </span>
                )}{' '}
                {card.caution === null ? null : (
                  <StatusBadge tone="warn" label={card.caution} />
                )}
              </p>
            </div>
          </div>
        )
      })}
    </RadioGroup>
  )
}
