// Review context — domain errors
// Per architecture: "Tagged errors with _tag field for pattern matching."

import { createErrorFactory } from '#/shared/domain/errors'

export type ReviewErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'property_not_found'
  | 'connection_not_found'
  | 'connection_inactive'
  | 'sync_failed'
  | 'invalid_rating'
  | 'invalid_reply'
  | 'review_not_found'
  | 'reply_not_found'
  | 'reply_already_exists'
  | 'invalid_transition'
  | 'reply_publish_failed'
  | 'invalid_row'
  | 'repo_upsert_failed'
  | 'build_config_error'

export type ReviewError = Readonly<{
  _tag: 'ReviewError'
  code: ReviewErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const reviewError = createErrorFactory<ReviewError['_tag']>('ReviewError')

export const isReviewError = (e: unknown): e is ReviewError =>
  typeof e === 'object' && e !== null && (e as ReviewError)._tag === 'ReviewError'
