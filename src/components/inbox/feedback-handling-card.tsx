import { useState } from 'react'
import { CheckCircle2, Clock3, History, LockKeyhole } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type {
  FeedbackHandlingState,
  InboxItem,
} from '#/contexts/inbox/application/public-api'
import type { InboxDetailState } from './use-inbox-detail'
import { formatDateTime } from './utils'
import {
  FeedbackHandlingDialog,
  type FeedbackHandlingDecision,
} from './feedback-handling-dialog'
import {
  feedbackHandlingOutcomeLabel,
  feedbackHandlingTimelineLabel,
} from './feedback-handling-presentation'

type Props = Readonly<{
  item: InboxItem
  state: FeedbackHandlingState
  markFeedbackHandled: InboxDetailState['markFeedbackHandled']
  correctFeedbackHandlingOutcome: InboxDetailState['correctFeedbackHandlingOutcome']
}>

export function FeedbackHandlingCard({
  item,
  state,
  markFeedbackHandled,
  correctFeedbackHandlingOutcome,
}: Props) {
  const { can } = usePermissions()
  const [dialogMode, setDialogMode] = useState<'mark' | 'correct' | null>(null)
  const current = state.currentOutcome
  const canHandle = can('inbox.write') && can('feedback.handle')

  const confirm = async (decision: FeedbackHandlingDecision) => {
    const expected = {
      expectedCommandRevision: item.commandRevision,
      expectedCycleNumber: state.cycleNumber,
      expectedSourceRevision: state.sourceRevision,
      expectedStateRevision: state.stateRevision,
    }
    if (dialogMode === 'mark') {
      return markFeedbackHandled({
        data: {
          inboxItemId: item.id,
          ...expected,
          ...decision,
        },
      })
    }
    if (dialogMode === 'correct' && current) {
      return correctFeedbackHandlingOutcome({
        data: {
          inboxItemId: item.id,
          ...expected,
          expectedOutcomeId: current.id,
          expectedOutcomeRevision: current.outcomeRevision,
          ...decision,
        },
      })
    }
    return Promise.resolve()
  }

  const mutation =
    dialogMode === 'correct' ? correctFeedbackHandlingOutcome : markFeedbackHandled

  return (
    <section
      aria-labelledby="feedback-handling-title"
      className="overflow-hidden rounded-xl border bg-card"
    >
      <div className="flex flex-wrap items-start gap-3 border-b bg-muted/25 px-4 py-3.5">
        <div className="rounded-full border bg-background p-2 text-muted-foreground">
          <CheckCircle2 className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="feedback-handling-title" className="text-sm font-semibold">
            Feedback handling
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Record the manager outcome while keeping the guest’s rating unchanged.
          </p>
        </div>
        <Badge variant={state.status === 'open' ? 'secondary' : 'outline'}>
          {state.status === 'open' ? 'Needs attention' : 'Handled'}
        </Badge>
      </div>

      <div className="space-y-4 p-4">
        {state.status === 'open' ? (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
              When the follow-up is complete, choose one outcome to close this work.
            </p>
            {canHandle ? (
              <Button size="sm" onClick={() => setDialogMode('mark')}>
                Mark as handled
              </Button>
            ) : null}
          </div>
        ) : current ? (
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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDialogMode('correct')}
                >
                  Correct outcome
                </Button>
              ) : null}
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <History className="size-3.5" />
                Outcome history
              </div>
              <ol className="space-y-2">
                {state.history.map((fact) => (
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
          </>
        ) : state.closeReason === 'guest_withdrawn' ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            This feedback was withdrawn by the guest. No manager outcome was recorded.
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            This feedback is closed without a manager outcome. Reopen it if more follow-up
            is needed.
          </p>
        )}
      </div>

      {dialogMode ? (
        <FeedbackHandlingDialog
          key={`${dialogMode}-${current?.id ?? 'open'}`}
          mode={dialogMode}
          open
          onOpenChange={(open) => {
            if (!open) setDialogMode(null)
          }}
          initialOutcome={dialogMode === 'correct' ? current?.outcome : undefined}
          initialNote={dialogMode === 'correct' ? current?.internalNote : null}
          mutation={mutation}
          onConfirm={confirm}
        />
      ) : null}
    </section>
  )
}
