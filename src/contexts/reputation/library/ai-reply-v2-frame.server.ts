import type { RenderReplyInput } from '#/shared/reply-library/render-reply'
import {
  renderReply,
  digestResolvedReplyVoice,
} from '#/shared/reply-library/render-reply'
import { replyBand } from '#/shared/reply-library/reply-voice'
import {
  replyContainsThanks,
  type ReplyDraftingV2Frame,
} from '#/shared/reply-drafting-v2-frame'
import type { ReplyVoiceChoices } from '#/shared/reply-drafting-v2-binding'

export type AiFrameReservation = Readonly<{
  choices: ReplyVoiceChoices
  closingOrder: readonly number[]
}>

const BODY_MARKER = 'RepKeyBodyMarker'

/** Pre-render local candidates. No local frame or identity goes into provider input. */
export function buildAiReplyV2Frame(
  input: Omit<RenderReplyInput, 'body' | 'choices'>,
  reservation: AiFrameReservation,
): ReplyDraftingV2Frame {
  const band = replyBand(input.rating, input.hasText)
  const voiceDigest = digestResolvedReplyVoice(input.voice, input.languageGroup)
  const closings = input.voice.localized[input.languageGroup].closings[band].value
  const candidates = [...reservation.closingOrder, -1].map((closing) => {
    const choices = { ...reservation.choices, closing }
    const voice =
      closing < 0
        ? {
            ...input.voice,
            localized: {
              ...input.voice.localized,
              [input.languageGroup]: {
                ...input.voice.localized[input.languageGroup],
                closings: {
                  ...input.voice.localized[input.languageGroup].closings,
                  [band]: {
                    value: [],
                    source:
                      input.voice.localized[input.languageGroup].closings[band].source,
                  },
                },
              },
            },
          }
        : input.voice
    const rendered = renderReply({ ...input, voice, body: BODY_MARKER, choices })
    const marker = rendered.text.indexOf(BODY_MARKER)
    if (marker < 0) throw new TypeError('Local reply body marker missing')
    return {
      prefix: rendered.text.slice(0, marker).trim(),
      suffix: rendered.text.slice(marker + BODY_MARKER.length).trim(),
      choices,
      thanks: replyContainsThanks(closings[closing] ?? ''),
    }
  })
  return {
    voiceDigest,
    reviewerDisplayName: input.reviewerDisplayName,
    contact: input.voice.contact.value,
    signerName: input.voice.signerName.value,
    signerTitle: input.voice.signerTitle.value,
    businessName:
      input.voice.businessNameShort.value?.trim() || input.propertyDisplayName,
    candidates,
  }
}
