// Review context — the error a lost reply race answers.

import type { ReviewError } from '../domain/review-errors'
import { reviewError } from '../domain/review-errors'

/** A guarded store write matched no row: the reply moved after it was read. */
export const replyChangedConcurrently = (): ReviewError =>
  reviewError('invalid_transition', 'Reply status changed concurrently')
