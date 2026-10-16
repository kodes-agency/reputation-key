// The setup's two explanations, opened on request below the plan (E2/E4): "How
// we worked this out" (the maths, the downside, an example of the average, and
// that it is a forecast, not a target for guests or staff) and "Why every
// guest" (R2-12 verbatim, then why asked guests rate higher). Each opens from
// the shared `ExplainTrigger`, takes the focus, closes on Escape or its own
// Close, and is held in the draft so a turned phone keeps it open.
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import type { RatingGoalSetupInputs } from '#/contexts/reporting/application/dto/rating-goal-setup.types'
import { ExplainTrigger } from '#/components/ui/explain-trigger'
import { IconButton } from '#/components/ui/icon-button'
import { Popover, PopoverContent } from '#/components/ui/popover'
import { PLAN_POLICY_LINE, UNASKED_REVIEWS_LINE } from './rating-goal-copy'
import { workedOutParagraphs } from './rating-goal-setup-copy'
import type { PaceUnit, SetupPlan } from './rating-goal-setup-draft'
import { tenthsText } from './rating-goal-view'

type Which = 'why' | 'ask'

type Props = Readonly<{
  plan: SetupPlan
  inputs: RatingGoalSetupInputs
  unit: PaceUnit
  open: Which | undefined
  small: boolean
  onToggle: (which: Which) => void
}>

function Explanation({
  which,
  label,
  title,
  props,
  children,
}: Readonly<{
  which: Which
  label: string
  title: string
  props: Props
  children: ReactNode
}>) {
  return (
    <Popover open={props.open === which} onOpenChange={() => props.onToggle(which)}>
      <ExplainTrigger className="text-link">{label}</ExplainTrigger>
      <PopoverContent
        side="top"
        aria-label={title}
        className="relative flex flex-col gap-2 text-sm text-muted-foreground"
        style={{
          width: props.small ? 'calc(100vw - 2rem)' : 520,
          maxWidth: 'calc(100vw - 2rem)',
        }}
      >
        <IconButton
          label="Close"
          size="icon-sm"
          tooltip={false}
          className="absolute right-3 top-3"
          onClick={() => props.onToggle(which)}
        >
          <X aria-hidden="true" />
        </IconButton>
        <p className="pe-12 font-semibold text-foreground">{title}</p>
        {children}
      </PopoverContent>
    </Popover>
  )
}

export function RatingGoalSetupPopovers(props: Props) {
  const { plan, inputs, unit } = props
  return (
    <>
      <Explanation
        which="why"
        label="How we worked this out"
        title={`How we worked out ${tenthsText(plan.goal.targetTenths)}`}
        props={props}
      >
        {workedOutParagraphs(plan, inputs, unit).map((runs, index) => (
          <p key={index}>
            {runs.map((run, part) =>
              run.strong === true ? (
                <b key={part} className="font-semibold text-foreground">
                  {run.text}
                </b>
              ) : (
                <span key={part}>{run.text}</span>
              ),
            )}
          </p>
        ))}
      </Explanation>
      <span aria-hidden="true">·</span>
      <Explanation
        which="ask"
        label="Why every guest"
        title="Why ask every guest"
        props={props}
      >
        <p>{PLAN_POLICY_LINE}</p>
        <p>{UNASKED_REVIEWS_LINE}</p>
      </Explanation>
    </>
  )
}
