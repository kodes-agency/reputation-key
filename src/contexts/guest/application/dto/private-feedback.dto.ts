import { z } from 'zod/v4'
import { unicodeCodePointLength } from '#/shared/domain/unicode'
import {
  MAX_PRIVATE_FEEDBACK_LENGTH,
  normalizePrivateFeedbackText,
} from '../../domain/private-feedback-text'

/**
 * Application-boundary parser for guest-authored private feedback. Transport
 * handlers consume this DTO rather than reaching into Guest domain modules.
 */
export const privateFeedbackTextSchema = z
  .string()
  .transform(normalizePrivateFeedbackText)
  .superRefine((value, context) => {
    const length = unicodeCodePointLength(value)
    if (length === 0) {
      context.addIssue({ code: 'custom', message: 'Feedback cannot be empty' })
    } else if (length > MAX_PRIVATE_FEEDBACK_LENGTH) {
      context.addIssue({
        code: 'custom',
        message: `Feedback must be at most ${MAX_PRIVATE_FEEDBACK_LENGTH} characters`,
      })
    }
  })
