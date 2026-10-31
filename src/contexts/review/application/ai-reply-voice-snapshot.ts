import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import { isBuiltinReplyVoiceLanguageGroup } from '#/shared/reply-library/reply-voice-language-groups'
import { BUILTIN_REPLY_VOICE, resolveVoice } from '#/shared/reply-library/reply-voice'
import type { ReplyLibraryRepository } from './ports/reply-library.repository'
import type { ReviewRepository } from './ports/review.repository'

/** One tenant-scoped source of the voice and review used by both frame versions. */
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
  return {
    snapshot,
    review,
    languageGroup: input.languageGroup,
    voice: resolveVoice(
      BUILTIN_REPLY_VOICE,
      snapshot.accountVoice,
      snapshot.propertyVoice,
    ),
  }
}
