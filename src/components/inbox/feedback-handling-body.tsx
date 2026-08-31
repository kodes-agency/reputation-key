import { Clock3, History, LockKeyhole } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { FeedbackHandlingState } from '#/contexts/inbox/application/public-api'
import { formatDateTime } from './utils'
import {
  feedbackHandlingOutcomeLabel,
  feedbackHandlingTimelineLabel,
} from './feedback-handling-presentation'

type OutcomeFact = FeedbackHandlingState['history'][number]

function OutcomeHistory({ history }: Readonly<{ history: ReadonlyArray<OutcomeFact> }>) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <History className="size-3.5" />
        Outcome history
      </div>
      <ol className="space-y-2">
        {history.map((fact) => (
          <li key={fact.id} className="rounded-lg border px-3 py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium">
                {feedbackHandlingTimelineLabel(fact.outcomeRevision)} ·{' '}
                {feedbackHandlingOutcomeLabel(fact.outcome)}
              </p>
              <time className="text-xs text-muted-foreground">
                {formatDateTime(fact.recordedAt)}
              </time>
            </div>
            {fact.internalNote ? (
              <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
                <span>{fact.internalNote}</span>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  )
}

function HandledBody({
  state,
  current,
  canHandle,
  onCorrect,
}: Readonly<{
  state: FeedbackHandlingState
  current: OutcomeFact
  canHandle: boolean
  onCorrect: () => void
}>) {
  return (
    <>
      <div className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Current outcome
          </p>
          <p className="mt-1 text-sm font-semibold">
            {feedbackHandlingOutcomeLabel(current.outcome)}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" />
            Completed {formatDateTime(current.completionAt)}
          </p>
        </div>
        {canHandle ? (
          <Button size="sm" variant="outline" onClick={onCorrect}>
            Correct outcome
          </Button>
        ) : null}
      </div>

      <OutcomeHistory history={state.history} />
    </>
  )
}

function OpenBody({
  canHandle,
  onMark,
}: Readonly<{ canHandle: boolean; onMark: () => void }>) {
  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
        When the follow-up is complete, choose one outcome to close this work.
      </p>
      {canHandle ? (
        <Button size="sm" onClick={onMark}>
          Mark as handled
        </Button>
      ) : null}
    </div>
  )
}

type Props = Readonly<{
  state: FeedbackHandlingState
  canHandle: boolean
  onMark: () => void
  onCorrect: () => void
}>

/**
 * The four terminal shapes of a handling cycle: still open, closed with a
 * recorded outcome, withdrawn by the guest, or closed without an outcome.
 */
export function FeedbackHandlingBody({ state, canHandle, onMark, onCorrect }: Props) {
  if (state.status === 'open') {
    return <OpenBody canHandle={canHandle} onMark={onMark} />
  }

  const current = state.currentOutcome
  if (current) {
    return (
      <HandledBody
        state={state}
        current={current}
        canHandle={canHandle}
        onCorrect={onCorrect}
      />
    )
  }

  if (state.closeReason === 'guest_withdrawn') {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        This feedback was withdrawn by the guest. No manager outcome was recorded.
      </p>
    )
  }

  return (
    <p className="text-sm leading-relaxed text-muted-foreground">
      This feedback is closed without a manager outcome. Reopen it if more follow-up is
      needed.
    </p>
  )
}
