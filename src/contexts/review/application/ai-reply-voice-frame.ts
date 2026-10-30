import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import { isBuiltinReplyVoiceLanguageGroup } from '#/shared/reply-library/reply-voice-language-groups'
import type { ReplyTemplateLanguageGroup } from '#/shared/reply-language-catalogue'
import {
  digestResolvedReplyVoice,
  isReplyRenderError,
  renderReply,
} from '#/shared/reply-library/render-reply'
import { BUILTIN_REPLY_VOICE, resolveVoice } from '#/shared/reply-library/reply-voice'
import type { Tx } from '#/shared/outbox/commit'
import type { ReplyLibraryRepository } from './ports/reply-library.repository'
import type { ReviewRepository } from './ports/review.repository'

export type AiReplyLocalFrame = Readonly<{
  prefix: string
  suffix: string
  voiceDigest: string
  reviewerDisplayName: string | null
  contact: string | null
  signerName: string | null
  signerTitle: string | null
  businessName: string
}>

export type AiReplyVoicePublicApi = Readonly<{
  resolveLocalFrame(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      reviewId: ReviewId
      languageGroup: ReplyTemplateLanguageGroup
    }>,
  ): Promise<AiReplyLocalFrame | null>
  isCurrentVoice(
    tx: Tx,
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      languageGroup: string
      voiceDigest: string
    }>,
  ): Promise<boolean>
}>

const BODY_MARKER = 'RepKeyBodyMarker'

export function createAiReplyVoicePublicApi(
  deps: Readonly<{
    repository: ReplyLibraryRepository
    reviews: ReviewRepository
  }>,
): AiReplyVoicePublicApi {
  return Object.freeze({
    resolveLocalFrame: async (input) => {
      if (!isBuiltinReplyVoiceLanguageGroup(input.languageGroup)) return null
      const [snapshot, review] = await Promise.all([
        deps.repository.loadSnapshot(input.organizationId, input.propertyId),
        deps.reviews.findById(input.reviewId, input.organizationId),
      ])
      if (!snapshot || !review || review.propertyId !== input.propertyId) return null
      const languageGroup = input.languageGroup
      const voice = resolveVoice(
        BUILTIN_REPLY_VOICE,
        snapshot.accountVoice,
        snapshot.propertyVoice,
      )
      const rendered = renderFrameOrNull({
        body: BODY_MARKER,
        voice,
        languageGroup,
        rating: review.rating,
        hasText: Boolean(review.text?.trim()),
        reviewerDisplayName: review.reviewerName,
        propertyDisplayName: snapshot.propertyName,
        choices: {
          closing: 0,
          signOff: 0,
          contactSentence: 0,
          emoji: 0,
          includeContact: true,
        },
      })
      if (rendered === null) return null
      const markerAt = rendered.text.indexOf(BODY_MARKER)
      if (markerAt < 0) return null
      return {
        prefix: rendered.text.slice(0, markerAt).trim(),
        suffix: rendered.text.slice(markerAt + BODY_MARKER.length).trim(),
        voiceDigest: rendered.voiceDigest,
        reviewerDisplayName: review.reviewerName,
        contact: voice.contact.value,
        signerName: voice.signerName.value,
        signerTitle: voice.signerTitle.value,
        businessName: voice.businessNameShort.value?.trim() || snapshot.propertyName,
      }
    },
    isCurrentVoice: async (tx, input) => {
      if (
        !isBuiltinReplyVoiceLanguageGroup(input.languageGroup) ||
        deps.repository.loadVoiceOverridesForShare === undefined
      ) {
        return false
      }
      const stored = await deps.repository.loadVoiceOverridesForShare(
        tx,
        input.organizationId,
        input.propertyId,
      )
      if (stored === null) return false
      const languageGroup = input.languageGroup
      const voice = resolveVoice(
        BUILTIN_REPLY_VOICE,
        stored.accountVoice,
        stored.propertyVoice,
      )
      return digestResolvedReplyVoice(voice, languageGroup) === input.voiceDigest
    },
  })
}

/** A voice too long to frame any reply leaves the draft unframed rather than failing it. */
function renderFrameOrNull(
  input: Parameters<typeof renderReply>[0],
): ReturnType<typeof renderReply> | null {
  try {
    return renderReply(input)
  } catch (error) {
    if (isReplyRenderError(error)) return null
    throw error
  }
}
