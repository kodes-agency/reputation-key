import { ok, err } from '#/shared/domain'
import type { Result } from '#/shared/domain'
import type { GuestError } from './errors'
import { guestError } from './errors'
import { unicodeCodePointLength } from '#/shared/domain/unicode'
import {
  MAX_PRIVATE_FEEDBACK_LENGTH,
  normalizePrivateFeedbackText,
} from './private-feedback-text'
import type { ScanSource } from './types'

const VALID_SOURCES: ReadonlySet<string> = new Set(['qr', 'nfc', 'direct'])

export const validateRating = (value: number): Result<number, GuestError> =>
  value >= 1 && value <= 5 && Number.isInteger(value)
    ? ok(value)
    : err(guestError('invalid_rating', 'Rating must be an integer between 1 and 5'))

export const validateFeedback = (comment: string): Result<string, GuestError> => {
  const normalized = normalizePrivateFeedbackText(comment)
  const length = unicodeCodePointLength(normalized)
  if (length === 0) {
    return err(guestError('feedback_empty', 'Feedback cannot be empty'))
  }
  if (length > MAX_PRIVATE_FEEDBACK_LENGTH) {
    return err(
      guestError(
        'feedback_too_long',
        `Feedback must be at most ${MAX_PRIVATE_FEEDBACK_LENGTH} characters`,
        { max: MAX_PRIVATE_FEEDBACK_LENGTH },
      ),
    )
  }
  return ok(normalized)
}

export const validateSource = (source: string): Result<ScanSource, GuestError> =>
  VALID_SOURCES.has(source)
    ? ok(source as ScanSource)
    : err(guestError('invalid_source', 'Source must be qr, nfc, or direct'))
