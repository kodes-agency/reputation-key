import { Result } from 'neverthrow'
import type { Rating, Feedback, ScanSource } from './types'
import type {
  RatingId,
  FeedbackId,
  OrganizationId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import type { GuestError } from './errors'
import { validateRating, validateFeedback, validateSource } from './rules'

export type BuildRatingInput = Readonly<{
  id: RatingId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  sessionId: string
  value: number
  source: ScanSource
  ipHash: string
  now: Date
}>

export const buildRating = (input: BuildRatingInput): Result<Rating, GuestError> => {
  const valueResult = validateRating(input.value)
  const sourceResult = validateSource(input.source)

  return Result.combine([valueResult, sourceResult]).map(
    ([validValue, _validSource]): Rating => ({
      id: input.id,
      organizationId: input.organizationId,
      portalId: input.portalId,
      propertyId: input.propertyId,
      sessionId: input.sessionId,
      value: validValue,
      source: input.source,
      ipHash: input.ipHash,
      createdAt: input.now,
    }),
  )
}

export type BuildFeedbackInput = Readonly<{
  id: FeedbackId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  sessionId: string
  ratingId: RatingId | null
  comment: string
  source: ScanSource
  ipHash: string
  now: Date
}>

export const buildFeedback = (
  input: BuildFeedbackInput,
): Result<Feedback, GuestError> => {
  const commentResult = validateFeedback(input.comment)
  const sourceResult = validateSource(input.source)

  return Result.combine([commentResult, sourceResult]).map(
    ([validComment, _validSource]): Feedback => ({
      id: input.id,
      organizationId: input.organizationId,
      portalId: input.portalId,
      propertyId: input.propertyId,
      sessionId: input.sessionId,
      ratingId: input.ratingId,
      comment: validComment,
      source: input.source,
      ipHash: input.ipHash,
      createdAt: input.now,
    }),
  )
}
