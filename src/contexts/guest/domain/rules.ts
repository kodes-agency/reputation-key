import { ok, err } from '#/shared/domain'
import type { Result } from '#/shared/domain'
import type { GuestError } from './errors'
import { guestError } from './errors'
import type { ScanSource } from './types'

const VALID_SOURCES: ReadonlySet<string> = new Set(['qr', 'nfc', 'direct'])

export const validateRating = (value: number): Result<number, GuestError> =>
  value >= 1 && value <= 5 && Number.isInteger(value)
    ? ok(value)
    : err(guestError('invalid_rating', 'Rating must be an integer between 1 and 5'))

export const validateFeedback = (comment: string): Result<string, GuestError> => {
  const trimmed = comment.trim()
  if (trimmed.length === 0) {
    return err(guestError('feedback_empty', 'Feedback cannot be empty'))
  }
  if (trimmed.length > 1000) {
    return err(
      guestError('feedback_too_long', 'Feedback must be at most 1000 characters', {
        max: 1000,
      }),
    )
  }
  return ok(trimmed)
}

export const validateSource = (source: string): Result<ScanSource, GuestError> =>
  VALID_SOURCES.has(source)
    ? ok(source as ScanSource)
    : err(guestError('invalid_source', 'Source must be qr, nfc, or direct'))
