// The Monday check-in above a climbing Google rating goal's card (round 5,
// PLAN-D D-3, owner answer Q4, mock D4): last week against the plan, and Keep,
// Raise or Ease for this week. Never automatic: nothing here runs without a
// press, and nothing changes unless a manager chooses. It is a labelled region
// ("Last week"), not a live region around three buttons, so a page that loads
// with it says it in turn. The commands come from the page that draws it (the
// Goals page and the Property Overview), as the wizard's do; once one is
// answered the page reads the goal again, the check-in is gone, and the focus
// goes to the card's title.
import { useState } from 'react'
import { toast } from 'sonner'
import type {
  RatingGoalCardView,
  RatingGoalKeepResult,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { GoalCheckIn, GoalWithCheckIn } from './goal-check-in'
import { RatingGoalCard } from './rating-goal-card'
import { RATING_GOAL_HEADING_ID } from './rating-goal-card-header'
import { withRatingGoalRefusals } from './rating-goal-refusal'
import {
  recapRefusals,
  recapToasts,
  recapWords,
  type RecapChoice,
} from './rating-goal-recap-view'

type GoalRef = Readonly<{ propertyId: string; goalId: string }>

/** The commands a check-in sends, handed down by the page (components import no routes). */
export type RatingGoalRecapCommands = Readonly<{
  keepPaceFn: (
    input: Readonly<{ data: GoalRef & Readonly<{ weekStart: string }> }>,
  ) => Promise<RatingGoalKeepResult>
  changeRatingGoalFn: (
    input: Readonly<{
      data: GoalRef & Readonly<{ expectedVersion: number; paceTenthsPerWeek: number }>
    }>,
  ) => Promise<unknown>
  /** Reads the goal (and what moves with its pace) again. */
  onAnswered: () => Promise<void>
}>

type Props = Readonly<{
  card: RatingGoalCardView
  propertyId: string
  commands: RatingGoalRecapCommands
}>

const focusTitle = () => document.getElementById(RATING_GOAL_HEADING_ID)?.focus()

type Pressed = 'keep' | 'change' | null

/**
 * Keep, and a change of pace: each refusing in plain words, each read again
 * once answered. The two keep their errors apart, so the banner says the one
 * pressed last, never an older refusal of the other.
 */
function useRecapCommands({ card, propertyId, commands }: Props) {
  const [pressed, setPressed] = useState<Pressed>(null)
  const answered = async () => {
    await commands.onAnswered()
    focusTitle()
  }
  const keep = useActionMutation(
    withRatingGoalRefusals(commands.keepPaceFn, recapRefusals),
    {
      successMessage:
        card.paceTenthsPerWeek === null
          ? undefined
          : recapToasts.kept(card.paceTenthsPerWeek),
      onSuccess: answered,
    },
  )
  const change = useActionMutation(
    withRatingGoalRefusals(commands.changeRatingGoalFn, recapRefusals),
    {
      onSuccess: async (_, input) => {
        await answered()
        // The toast names the pace that was sent: Raise and Ease share the command.
        toast.success(recapToasts.changed(input.data.paceTenthsPerWeek))
      },
    },
  )
  const goal = { propertyId, goalId: card.goalId }
  const errors = { keep: keep.error, change: change.error }
  return {
    pending: keep.isPending || change.isPending,
    error: pressed === null ? null : errors[pressed],
    keep: (weekStart: string) => {
      setPressed('keep')
      return keep({ data: { ...goal, weekStart } }).catch(() => undefined)
    },
    change: (pace: number) => {
      setPressed('change')
      return change({
        data: { ...goal, expectedVersion: card.version, paceTenthsPerWeek: pace },
      }).catch(() => undefined)
    },
  }
}

/** Raise and Ease: the same command at the pace each names; none where there is no such choice. */
function paceChoice(
  key: string,
  choice: RecapChoice | null,
  change: (pace: number) => Promise<unknown>,
) {
  return choice === null
    ? []
    : [{ key, label: choice.label, onPress: () => void change(choice.paceTenthsPerWeek) }]
}

function RatingGoalRecap(props: Props) {
  const words = recapWords(props.card)
  const commands = useRecapCommands(props)
  const recap = props.card.recap
  if (words === null || recap === null) return null
  const keep =
    words.keep === null
      ? []
      : [
          {
            key: 'keep',
            label: words.keep.label,
            primary: true,
            onPress: () => void commands.keep(recap.weekStart),
          },
        ]
  return (
    <GoalCheckIn
      slot="rating-goal-recap"
      label={words.label}
      headline={words.headline}
      sub={words.sub}
      choices={[
        ...keep,
        ...paceChoice('raise', words.raise, commands.change),
        ...paceChoice('ease', words.ease, commands.change),
      ]}
      busy={commands.pending}
      note={words.note}
      error={commands.error}
    />
  )
}

type CardProps = Readonly<{
  card: RatingGoalCardView
  propertyId: string
  timezone: string
  now: Date
  /** The page's commands; without them (or without goal.update) there is no check-in. */
  recap?: RatingGoalRecapCommands
}>

/**
 * The goal's card, with the Monday check-in above it while one is due and the
 * viewer may change the goal (E29, E30). The same on the Goals page and the
 * Overview.
 */
export function RatingGoalCardWithRecap({ recap, ...props }: CardProps) {
  const { can } = usePermissions()
  const due = props.card.recap !== null && can('goal.update')
  return (
    <GoalWithCheckIn
      checkIn={
        due && recap !== undefined ? (
          <RatingGoalRecap
            card={props.card}
            propertyId={props.propertyId}
            commands={recap}
          />
        ) : null
      }
    >
      <RatingGoalCard {...props} />
    </GoalWithCheckIn>
  )
}
