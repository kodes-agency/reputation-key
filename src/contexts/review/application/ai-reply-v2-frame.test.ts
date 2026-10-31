import { describe, expect, it } from 'vitest'
import { BUILTIN_REPLY_VOICE, resolveVoice } from '#/shared/reply-library/reply-voice'
import { frameReplyDraftingV2 } from '#/shared/reply-drafting-v2-frame'
import { buildAiReplyV2Frame } from './ai-reply-v2-frame'
import { digestResolvedReplyVoice } from '#/shared/reply-library/render-reply'

const CHOICES = {
  closing: 0,
  signOff: 0,
  contactSentence: 0,
  emoji: 0,
  includeContact: true,
}
function frame(
  closings: readonly string[],
  closingOrder: readonly number[] = closings.map((_, index) => index),
) {
  const voice = resolveVoice(BUILTIN_REPLY_VOICE, null, {
    overriddenFields: [],
    localized: { 'en-Latn': { closings: { positiveText: closings } } },
  })
  return {
    voice,
    result: buildAiReplyV2Frame(
      {
        voice,
        languageGroup: 'en-Latn',
        rating: 5,
        hasText: true,
        reviewerDisplayName: 'Jane Guest',
        propertyDisplayName: 'Example Hotel',
      },
      { choices: CHOICES, closingOrder },
    ),
  }
}

describe('body-aware AI frame choices', () => {
  it('omits an all-thanks closing after a body which already thanks', () => {
    const { result } = frame(['Thank you for sharing.', 'Thanks for your review.'])
    const rendered = frameReplyDraftingV2(
      'Thank you for telling us about the quiet room.',
      result,
    )
    expect(rendered.voiceChoices.closing).toBe(-1)
    expect(rendered.replyText).not.toContain('Thank you for sharing.')
    expect(rendered.replyText).not.toContain('Thanks for your review.')
  })
  it('chooses the first eligible non-thanking option in LRU order', () => {
    const { result } = frame(
      ['Thank you for sharing.', 'Wishing you a lovely day.', 'Many thanks.'],
      [2, 1, 0],
    )
    const rendered = frameReplyDraftingV2(
      'We appreciate hearing about the quiet room.',
      result,
    )
    expect(rendered.voiceChoices.closing).toBe(1)
    expect(rendered.replyText).toContain('Wishing you a lovely day.')
  })
  it('handles explicitly empty closings and a configured empty option', () => {
    expect(
      frameReplyDraftingV2('We are glad you enjoyed the quiet room.', frame([]).result)
        .voiceChoices.closing,
    ).toBe(-1)
    const empty = frameReplyDraftingV2(
      'Thank you for describing the quiet room.',
      frame(['']).result,
    )
    expect(empty.voiceChoices.closing).toBe(0)
    expect(empty.replyText).not.toContain('RepKeyBodyMarker')
  })
  it('rotates choices without changing the voice identity', () => {
    const first = frame(['Thank you for sharing.', 'Wishing you a lovely day.'], [0, 1])
    const second = frame(['Thank you for sharing.', 'Wishing you a lovely day.'], [1, 0])
    const a = frameReplyDraftingV2(
      'We are glad you enjoyed the quiet room.',
      first.result,
    )
    const b = frameReplyDraftingV2(
      'We are glad you enjoyed the quiet room.',
      second.result,
    )
    expect(a.voiceChoices.closing).toBe(0)
    expect(b.voiceChoices.closing).toBe(1)
    expect(a.voiceDigest).toBe(b.voiceDigest)
    expect(a.voiceDigest).toBe(digestResolvedReplyVoice(first.voice, 'en-Latn'))
    expect(a.replyText).not.toBe(b.replyText)
  })
})
