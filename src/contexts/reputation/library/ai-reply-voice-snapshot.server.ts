import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import { isBuiltinReplyVoiceLanguageGroup } from '#/shared/reply-library/reply-voice-language-groups'
import { BUILTIN_REPLY_VOICE, resolveVoice } from '#/shared/reply-library/reply-voice'
import type { RenderReplyInput } from '#/shared/reply-library/render-reply'
import type { ReplyLibraryRepository } from './reply-library-repository.port.server'
import type { ReviewRepository } from '../reviews/review-repository.port.server'

/** One tenant-scoped source of the voice and review used by every frame resolver. */
export async function readAiReplyVoiceSnapshot(
  deps: Readonly<{ repository: ReplyLibraryRepository; reviews: ReviewRepository }>,
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    reviewId: ReviewId
    languageGroup: string
  }>,
) {
  if (!isBuiltinReplyVoiceLanguageGroup(input.languageGroup)) return null
  const [snapshot, review] = await Promise.all([
    deps.repository.loadSnapshot(input.organizationId, input.propertyId),
    deps.reviews.findById(input.reviewId, input.organizationId),
  ])
  if (!snapshot || !review || review.propertyId !== input.propertyId) return null
  const voice = resolveVoice(
    BUILTIN_REPLY_VOICE,
    snapshot.accountVoice,
    snapshot.propertyVoice,
  )
  const languageGroup = input.languageGroup
  return {
    review,
    languageGroup,
    voice,
    frameInput: {
      voice,
      languageGroup,
      rating: review.rating,
      hasText: Boolean(review.text?.trim()),
      reviewerDisplayName: review.reviewerName,
      propertyDisplayName: snapshot.propertyName,
    } satisfies Omit<RenderReplyInput, 'body' | 'choices'>,
  }
}
