import { useState } from 'react'
import { toast } from 'sonner'
import type { MentionCorrectionAction } from '#/contexts/ai/application/public-api'
import {
  actionFailureMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { aiKeys, inboxKeys } from '#/shared/queries/query-keys'
import { outcomeOf, type CorrectionOutcome } from './review-correction-view'
import type { InboxServerFns } from './types'

/** The reading a manager is correcting, and where a correction shows up. */
export type ReviewCorrectionTarget = Readonly<{
  inboxItemId: string
  propertyId: string
  reviewId: string
  /** The reading on screen: a review read again since answers "not found". */
  analysisSequence: number
}>

type Request = Readonly<{ mentionOrdinal: number; action: MentionCorrectionAction }>

/** A refusal the server answered as a status, as the error a form's banner prints: a fresh one each time. */
function refusalError(sentence: string): ServerFunctionError {
  return new ServerFunctionError('AiError', sentence, 'refused', 422)
}

/**
 * "Not right?": the corrections a manager makes to one review's reading.
 *
 * A correction counts at once, wherever the reading is shown, so a success refreshes the
 * open review, the Inbox list (an issue filter may no longer hold it) and the Property's
 * Guest voice. There are two ways to ask, because a failure has one reporter: `apply` is a
 * click on a row, and a failure is a toast; `submit` is a form, and a failure rejects so the
 * form can print it above its own buttons.
 */
export function useReviewCorrection(
  input: Readonly<{
    correct: NonNullable<InboxServerFns['correctReviewMention']>
    target: ReviewCorrectionTarget
  }>,
) {
  const { correct, target } = input
  const send = (request: Request) =>
    correct({
      data: {
        reviewId: target.reviewId,
        analysisSequence: target.analysisSequence,
        ...request,
      },
    })
  const invalidateKeys = [
    inboxKeys.detail(target.inboxItemId),
    inboxKeys.lists(),
    aiKeys.guestVoiceV2Property(target.propertyId),
  ]
  const clicked = useActionMutation(send, {
    invalidateKeys,
    errorMessage: actionFailureMessage("Couldn't save that correction."),
  })
  const submitted = useActionMutation(send, { invalidateKeys })
  const [refusal, setRefusal] = useState<ServerFunctionError | null>(null)

  return {
    isPending: clicked.isPending || submitted.isPending,

    /** What a form shows of its last attempt: whether it is working, and how it ended if it did not succeed. */
    submission: { isPending: submitted.isPending, error: refusal ?? submitted.error },

    /** A click on a row. Resolves with how it ended; a refusal is a toast, and so is a failure. */
    apply: async (request: Request): Promise<CorrectionOutcome | null> => {
      try {
        const outcome = outcomeOf(await clicked(request), request.action)
        if (outcome.kind === 'refused') toast.error(outcome.sentence)
        return outcome
      } catch {
        return null
      }
    },

    /** A form's submit. A refusal is held for the form's banner and comes back as an outcome; a failure rejects. */
    submit: async (request: Request): Promise<CorrectionOutcome> => {
      setRefusal(null)
      const outcome = outcomeOf(await submitted(request), request.action)
      if (outcome.kind === 'refused') setRefusal(refusalError(outcome.sentence))
      return outcome
    },
  }
}
