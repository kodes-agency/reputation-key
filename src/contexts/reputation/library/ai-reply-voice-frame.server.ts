import { buildAiReplyV2Frame } from './ai-reply-v2-frame.server'
import { readAiReplyVoiceSnapshot } from './ai-reply-voice-snapshot.server'
import {
  resolveAiReplyV2Frame,
  resolveSavedReplyFrame,
  type ResolveSavedReplyFrameInput,
  type ResolveAiReplyV2FrameInput,
} from './resolve-ai-reply-v2-frame.server'
import type { ReplyDraftingV2Frame } from '#/shared/reply/reply-drafting-v2-frame'
import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import { isBuiltinReplyVoiceLanguageGroup } from '#/shared/reply-library/reply-voice-language-groups'
import type { ReplyTemplateLanguageGroup } from '#/shared/reply-language-catalogue'
import {
  digestResolvedReplyVoice,
  isReplyRenderError,
} from '#/shared/reply-library/render-reply'
import { BUILTIN_REPLY_VOICE, resolveVoice } from '#/shared/reply-library/reply-voice'
import type { Tx } from '#/shared/outbox/commit'
import type { ReplyLibraryRepository } from './reply-library-repository.port.server'
import type { ReviewRepository } from '../reviews/review-repository.port.server'

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
  resolveSavedFrame(
    input: ResolveSavedReplyFrameInput,
  ): Promise<Readonly<{ prefix: string; suffix: string }> | null>
  resolveV2Frame(input: ResolveAiReplyV2FrameInput): Promise<ReplyDraftingV2Frame | null>
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

export function createAiReplyVoicePublicApi(
  deps: Readonly<{
    repository: ReplyLibraryRepository
    reviews: ReviewRepository
  }>,
): AiReplyVoicePublicApi {
  return Object.freeze({
    resolveSavedFrame: (input) => resolveSavedReplyFrame(deps, input),
    resolveV2Frame: (input) => resolveAiReplyV2Frame(deps, input),
    resolveLocalFrame: async (input) => {
      const resolved = await readAiReplyVoiceSnapshot(deps, input)
      if (resolved === null) return null
      try {
        const { candidates, ...frame } = buildAiReplyV2Frame(resolved.frameInput, {
          choices: {
            closing: 0,
            signOff: 0,
            contactSentence: 0,
            emoji: 0,
            includeContact: true,
          },
          closingOrder: [0],
        })
        const [withClosing] = candidates
        if (withClosing === undefined) return null
        return { ...frame, prefix: withClosing.prefix, suffix: withClosing.suffix }
      } catch (error) {
        // A voice too long to frame any reply leaves the draft unframed rather than failing it.
        if (isReplyRenderError(error)) return null
        throw error
      }
    },
    isCurrentVoice: async (tx, input) => {
      if (!isBuiltinReplyVoiceLanguageGroup(input.languageGroup)) return false
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
