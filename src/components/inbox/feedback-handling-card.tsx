import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type {
  FeedbackHandlingState,
  InboxItem,
} from '#/contexts/inbox/application/public-api'
import type { InboxDetailState } from './use-inbox-detail'
import {
  FeedbackHandlingDialog,
  type FeedbackHandlingDecision,
} from './feedback-handling-dialog'
import { FeedbackHandlingBody } from './feedback-handling-body'
import {
  submitFeedbackHandlingDecision,
  type FeedbackHandlingDialogMode,
} from './feedback-handling-submit'

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
  const [dialogMode, setDialogMode] = useState<FeedbackHandlingDialogMode>(null)
  const current = state.currentOutcome
  const canHandle = can('inbox.write') && can('feedback.handle')

  const confirm = (decision: FeedbackHandlingDecision) =>
    submitFeedbackHandlingDecision({
      mode: dialogMode,
      item,
      state,
      decision,
      markFeedbackHandled,
      correctFeedbackHandlingOutcome,
    })

  const isCorrection = dialogMode === 'correct'
  const mutation = isCorrection ? correctFeedbackHandlingOutcome : markFeedbackHandled

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
        <FeedbackHandlingBody
          state={state}
          canHandle={canHandle}
          onMark={() => setDialogMode('mark')}
          onCorrect={() => setDialogMode('correct')}
        />
      </div>

      {dialogMode ? (
        <FeedbackHandlingDialog
          key={`${dialogMode}-${current?.id ?? 'open'}`}
          mode={dialogMode}
          open
          onOpenChange={(open) => {
            if (!open) setDialogMode(null)
          }}
          initialOutcome={isCorrection ? current?.outcome : undefined}
          initialNote={isCorrection ? current?.internalNote : null}
          mutation={mutation}
          onConfirm={confirm}
        />
      ) : null}
    </section>
  )
}
