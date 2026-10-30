import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogCancel,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { ReviewCorrectionRows } from './review-correction-rows'
import { useReviewCorrection, type ReviewCorrectionTarget } from './use-review-correction'
import type { ReadyAnalysisV3 } from './review-cause-view'
import type { InboxServerFns } from './types'

/**
 * "Not right?": a manager says what the AI got wrong about a review. Every line takes
 * effect as it is clicked, so the dialog has nothing to confirm; it closes when the manager
 * is done. The words a correction changes are the reading's, never the guest's: the review
 * itself is untouched, and a review the guest edits is read afresh without any of this.
 */
export function ReviewCorrectionDialog({
  analysis,
  target,
  correct,
}: Readonly<{
  analysis: ReadyAnalysisV3
  target: ReviewCorrectionTarget
  correct: NonNullable<InboxServerFns['correctReviewMention']>
}>): ReactNode {
  const correction = useReviewCorrection({ correct, target })
  return (
    <Dialog busy={correction.isPending}>
      <DialogTrigger asChild>
        <Button type="button" variant="link" size="inline" touch className="w-fit">
          Not right?
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} data-density="compact">
        <DialogHeader>
          <DialogTitle>Not right?</DialogTitle>
          <DialogDescription>
            Tell RepKey what it got wrong in this review. Guest voice for this property
            changes at once. The review itself is not changed.
          </DialogDescription>
        </DialogHeader>
        <ReviewCorrectionRows mentions={analysis.mentions} correction={correction} />
        <DialogFooter>
          <DialogCancel>Done</DialogCancel>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
