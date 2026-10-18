// The Monthly portal goal's month-start check-in, on its card (PLAN PG-15; copy
// deck K-1…K-11; mock PROPOSAL §4.4): on the first seven days of a month the
// read asks about, it takes the card's body. The month before as it stands,
// then a region named for the month ("For December"; never the Google rating
// goal's "Last week"), with "Use 45" and what it stands on ("How we worked this
// out"), "Keep 40", and "Other number", which opens the change sheet on the
// month now; and that nothing changes unless a manager chooses. With nothing
// counted there is no number, only Keep and another number. Nothing here is
// automatic: each press sends one command, once. Use is the change now with
// the month's change keys, as recommended; Keep records the month it answered.
// Once answered, the card is read again (the check-in is gone, for every
// manager) and the focus goes to the card's title. A refusal says why in a
// toast; one that means the card is behind reads it again.
import { useId, useRef } from 'react'
import { Check } from 'lucide-react'
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
import { Button } from '#/components/ui/button'
import { TONE_INK } from '#/components/ui/tone'
import { cn } from '#/lib/utils'
import { goalRefusalCode, withGoalRefusals } from './goal-refusal'
import { checkInLastMonthWords, checkInWords } from './portal-goal-check-in-view'
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
  /** Opens the change sheet, for "Other number"; without it there is no such link. */
  openSheet?: (intent: PortalGoalSheetIntent) => void
  /** The region heading's level: one below the card's title. */
  headingAs: 'h2' | 'h3' | 'h4'
}>

/** Refusals that mean the card is behind: it is read again, and the check-in with it. */
const BEHIND: ReadonlySet<string> = new Set([
  ...PORTAL_GOAL_BEHIND,
  'invalid_transition',
  'check_in_closed',
])

/** Use and Keep: each sent once however often it is pressed, then the card is read again. */
function useAnswers({ goal, checkIn, propertyId, commands, onAnswered }: Props) {
  const words = checkInWords(checkIn)
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

/** K-1, or K-6: the month before, met with a check, otherwise in neutral words. */
function LastMonthLine({ goal }: Readonly<{ goal: PortalGoalOfCard }>) {
  const words = checkInLastMonthWords(goal.lastMonth)
  if (words === null) return null
  return (
    <p
      className={cn(
        'flex items-center gap-1.5 text-sm tabular-nums',
        words.met ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {words.met ? (
        <Check className={cn('size-4 shrink-0', TONE_INK.positive)} aria-hidden="true" />
      ) : null}
      <span>{words.text}</span>
    </p>
  )
}

export function PortalGoalCheckIn(props: Props) {
  const { goal, checkIn, openSheet, headingAs: Heading } = props
  const headingId = useId()
  const answers = useAnswers(props)
  const { words } = answers
  return (
    <div className="flex flex-col gap-4">
      <LastMonthLine goal={goal} />
      <section
        aria-labelledby={headingId}
        data-slot="portal-goal-check-in"
        className="flex flex-col gap-3"
      >
        <Heading id={headingId} className="text-base font-semibold">
          {words.heading}
        </Heading>
        {words.lead === null ? null : <p className="text-sm">{words.lead}</p>}
        {words.use === null || checkIn.kind !== 'offer' ? null : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button
              pending={answers.using}
              pendingLabel="Saving…"
              disabled={answers.pending}
              onClick={answers.use}
            >
              {words.use.label}
            </Button>
            <p className="text-sm text-muted-foreground">
              {words.use.caption} <PortalGoalWorkedOut offer={checkIn.offer} />
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            variant="outline"
            pending={answers.keeping}
            pendingLabel="Saving…"
            disabled={answers.pending}
            onClick={answers.keep}
          >
            {words.keep.label}
          </Button>
          {openSheet === undefined ? null : (
            <Button
              variant="link"
              size="inline"
              touch
              disabled={answers.pending}
              onClick={() => openSheet({ mode: 'change', measure: goal.measure })}
            >
              {words.other}
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{words.foot}</p>
      </section>
    </div>
  )
}
