// Check-ins never apply changes automatically. Use sends the running month's change
// keys; Keep records the answered month. After either command, refresh the shared read
// and focus the card title because the strip disappears for every manager.

import { useRef } from 'react'
import type {
  ChangeMonthlyPortalGoalNowRequest,
  KeepMonthlyPortalGoalRequest,
  PortalGoalCheckIn as CheckIn,
  PortalGoalOfCard,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { GoalCheckIn } from '../../../../components/goals/goal-check-in'
import {
  goalRefusalCode,
  withGoalRefusals,
} from '../../../../components/goals/goal-refusal'
import { checkInWords } from './portal-goal-check-in-view'
import { changeRefusals, PORTAL_GOAL_BEHIND } from './portal-goal-sheet-refusals'
import type { PortalGoalSheetIntent } from './portal-goal-sheet-intent'
import { PortalGoalWorkedOut } from './portal-goal-worked-out'

/** The check-in's commands, handed down by the page (components import no routes). */
export type PortalGoalCheckInCommands = Readonly<{
  changeMonthlyPortalGoalNowFn: (
    input: Readonly<{ data: ChangeMonthlyPortalGoalNowRequest }>,
  ) => Promise<unknown>
  keepMonthlyPortalGoalFn: (
    input: Readonly<{ data: KeepMonthlyPortalGoalRequest }>,
  ) => Promise<unknown>
}>

type Asking = Extract<CheckIn, { kind: 'offer' | 'nothing' }>

type Props = Readonly<{
  goal: PortalGoalOfCard
  checkIn: Asking
  propertyId: string
  commands: PortalGoalCheckInCommands
  /** Reads the card again; once it is read, the focus goes to the card's title. */
  onAnswered: () => Promise<void>
  /** Opens the change sheet, for "Other number"; without it there is no such choice. */
  openSheet?: (intent: PortalGoalSheetIntent) => void
}>

/** Refusals that mean the card is behind: it is read again, and the check-in with it. */
const BEHIND: ReadonlySet<string> = new Set([
  ...PORTAL_GOAL_BEHIND,
  'invalid_transition',
  'check_in_closed',
])

/** Use and Keep: each sent once however often it is pressed, then the card is read again. */
function useAnswers({ goal, checkIn, propertyId, commands, onAnswered }: Props) {
  const words = checkInWords(checkIn, goal.lastMonth)
  const sending = useRef(false)
  const next = goal.change?.nextMonthKey ?? checkIn.month
  const options = (successMessage: string | undefined) => ({
    successMessage,
    errorMessage: actionErrorMessage,
    onSuccess: onAnswered,
    onError: (error: unknown) => {
      if (BEHIND.has(goalRefusalCode(error) ?? '')) void onAnswered()
    },
  })
  const refusals = changeRefusals(checkIn.month, next)
  const use = useActionMutation(
    withGoalRefusals(commands.changeMonthlyPortalGoalNowFn, refusals),
    options(words.use?.toast),
  )
  const keep = useActionMutation(
    withGoalRefusals(commands.keepMonthlyPortalGoalFn, refusals),
    options(words.keep.toast),
  )
  const once = (send: () => Promise<unknown>) => {
    if (sending.current) return
    sending.current = true
    // The toast says a refusal; settled here so it never escapes the click.
    void send()
      .catch(() => undefined)
      .finally(() => {
        sending.current = false
      })
  }
  const now = goal.change?.now ?? null
  return {
    words,
    pending: use.isPending || keep.isPending,
    using: use.isPending,
    keeping: keep.isPending,
    use: () =>
      once(async () => {
        if (now === null || words.use === null) return
        await use({
          data: {
            propertyId,
            programId: goal.programId,
            month: now.monthKey,
            targetValue: words.use.targetValue,
            expectedTarget: now.expectedTarget,
            expectedVersion: now.expectedVersion,
            expectedFollowingMonth: now.expectedFollowingMonth,
            targetSource: 'recommended',
          },
        })
      }),
    keep: () =>
      once(() =>
        keep({ data: { propertyId, programId: goal.programId, month: checkIn.month } }),
      ),
  }
}

export function PortalGoalCheckIn(props: Props) {
  const { goal, checkIn, openSheet } = props
  const answers = useAnswers(props)
  const { words } = answers
  const use =
    words.use === null || checkIn.kind !== 'offer'
      ? []
      : [
          {
            key: 'use',
            label: words.use.label,
            primary: true,
            pending: answers.using,
            onPress: answers.use,
          },
        ]
  const other =
    openSheet === undefined
      ? []
      : [
          {
            key: 'other',
            label: words.other,
            onPress: () => openSheet({ mode: 'change', measure: goal.measure }),
          },
        ]
  return (
    <GoalCheckIn
      slot="portal-goal-check-in"
      label={words.label}
      headline={words.headline}
      sub={
        checkIn.kind === 'offer' ? (
          <>
            {words.sub} <PortalGoalWorkedOut offer={checkIn.offer} />
          </>
        ) : (
          words.sub
        )
      }
      choices={[
        ...use,
        {
          key: 'keep',
          label: words.keep.label,
          // Keep is the one to take when there is no number to use.
          primary: use.length === 0,
          pending: answers.keeping,
          onPress: answers.keep,
        },
        ...other,
      ]}
      busy={answers.pending}
      note={words.note}
    />
  )
}
