// Review context — server function tests
// Tests DTO validation, error→status mapping.
// Pure unit tests — no DB needed.

import { describe, it, expect } from 'vitest'
import {
  reviewErrorStatus,
  reviewIdDto,
  draftReplyDto,
  rejectReplyDto,
} from './reply-read'
import { reviewError, isReviewError } from '../domain/errors'
import { MAX_REPLY_LENGTH } from '../domain/rules'

// ── DTO validation ──────────────────────────────────────────────────

describe('reviewIdDto', () => {
  it('parses valid UUID', () => {
    const result = reviewIdDto.safeParse({
      reviewId: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-UUID string', () => {
    const result = reviewIdDto.safeParse({ reviewId: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('rejects missing reviewId', () => {
    const result = reviewIdDto.safeParse({})
    expect(result.success).toBe(false)
  })
})

describe('draftReplyDto', () => {
  const validInput = {
    reviewId: '550e8400-e29b-41d4-a716-446655440000',
    text: 'Thank you for your review!',
  }

  it('parses valid input', () => {
    const result = draftReplyDto.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('rejects empty text', () => {
    const result = draftReplyDto.safeParse({ ...validInput, text: '' })
    expect(result.success).toBe(false)
  })

  it('rejects text exceeding max length', () => {
    const result = draftReplyDto.safeParse({
      ...validInput,
      text: 'x'.repeat(MAX_REPLY_LENGTH + 1),
    })
    expect(result.success).toBe(false)
  })

  it('accepts text at exactly max length', () => {
    const result = draftReplyDto.safeParse({
      ...validInput,
      text: 'x'.repeat(MAX_REPLY_LENGTH),
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing reviewId', () => {
    const result = draftReplyDto.safeParse({ text: 'Hello' })
    expect(result.success).toBe(false)
  })
})

describe('rejectReplyDto', () => {
  const validInput = {
    reviewId: '550e8400-e29b-41d4-a716-446655440000',
  }

  it('parses valid input without reason', () => {
    const result = rejectReplyDto.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('parses valid input with reason', () => {
    const result = rejectReplyDto.safeParse({ ...validInput, reason: 'Not appropriate' })
    expect(result.success).toBe(true)
  })

  it('rejects reason exceeding 1000 chars', () => {
    const result = rejectReplyDto.safeParse({ ...validInput, reason: 'x'.repeat(1001) })
    expect(result.success).toBe(false)
  })

  it('rejects missing reviewId', () => {
    const result = rejectReplyDto.safeParse({})
    expect(result.success).toBe(false)
  })
})

// ── Error → HTTP status mapping ─────────────────────────────────────

describe('reviewErrorStatus', () => {
  it('maps invalid_reply to 400', () => {
    expect(reviewErrorStatus('invalid_reply')).toBe(400)
  })

  it('maps invalid_rating to 400', () => {
    expect(reviewErrorStatus('invalid_rating')).toBe(400)
  })

  it('maps invalid_transition to 400', () => {
    expect(reviewErrorStatus('invalid_transition')).toBe(400)
  })

  it('maps unauthorized to 403', () => {
    expect(reviewErrorStatus('unauthorized')).toBe(403)
  })

  it('maps review_not_found to 404', () => {
    expect(reviewErrorStatus('review_not_found')).toBe(404)
  })

  it('maps reply_not_found to 404', () => {
    expect(reviewErrorStatus('reply_not_found')).toBe(404)
  })

  it('maps reply_already_exists to 409', () => {
    expect(reviewErrorStatus('reply_already_exists')).toBe(409)
  })

  it('maps property_not_found to 500', () => {
    expect(reviewErrorStatus('property_not_found')).toBe(500)
  })

  it('maps connection_not_found to 500', () => {
    expect(reviewErrorStatus('connection_not_found')).toBe(500)
  })

  it('maps connection_inactive to 500', () => {
    expect(reviewErrorStatus('connection_inactive')).toBe(500)
  })

  it('maps sync_failed to 500', () => {
    expect(reviewErrorStatus('sync_failed')).toBe(500)
  })

  it('maps reply_publish_failed to 500', () => {
    expect(reviewErrorStatus('reply_publish_failed')).toBe(500)
  })

  it('maps repo_upsert_failed to 500', () => {
    expect(reviewErrorStatus('repo_upsert_failed')).toBe(500)
  })

  it('maps build_config_error to 500', () => {
    expect(reviewErrorStatus('build_config_error')).toBe(500)
  })
})

// ── Error constructor + type guard ──────────────────────────────────

describe('reviewError and isReviewError', () => {
  it('creates a tagged error', () => {
    const err = reviewError('review_not_found', 'Review not found')
    expect(err._tag).toBe('ReviewError')
    expect(err.code).toBe('review_not_found')
    expect(err.message).toBe('Review not found')
  })

  it('isReviewError returns true for review errors', () => {
    const err = reviewError('unauthorized', 'No access')
    expect(isReviewError(err)).toBe(true)
  })

  it('isReviewError returns false for generic errors', () => {
    const err = new Error('Generic error')
    expect(isReviewError(err)).toBe(false)
  })

  it('isReviewError returns false for null', () => {
    expect(isReviewError(null)).toBe(false)
  })

  it('creates error with context', () => {
    const err = reviewError('reply_not_found', 'Reply missing', { reviewId: 'rev-1' })
    expect(err.context).toEqual({ reviewId: 'rev-1' })
  })
})
