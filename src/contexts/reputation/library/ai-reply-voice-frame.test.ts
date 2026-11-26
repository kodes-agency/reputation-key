import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import {
  digestResolvedReplyVoice,
  isReplyRenderError,
  renderReply,
} from '#/shared/reply-library/render-reply'
import { BUILTIN_REPLY_VOICE, resolveVoice } from '#/shared/reply-library/reply-voice'
import { reviewId } from '#/shared/domain/ids'
import type { Review } from '../domain/review-types'
import { createAiReplyVoicePublicApi } from './ai-reply-voice-frame.server'
import type {
  ReplyLibraryRepository,
  StoredReplyVoice,
} from './reply-library-repository.port.server'
import type { ReviewRepository } from '../reviews/review-repository.port.server'

const ORGANIZATION = organizationId('org-1')
const PROPERTY = propertyId('10000000-0000-4000-8000-000000000001')
const TX = {} as Tx

function api(loader: ReplyLibraryRepository['loadVoiceOverridesForShare']) {
  const repository = {
    loadSnapshot: vi.fn(),
    loadVoiceOverridesForShare: loader,
  } as unknown as ReplyLibraryRepository
  const reviews = { findById: vi.fn() } as unknown as ReviewRepository
  return createAiReplyVoicePublicApi({ repository, reviews })
}

const input = (voiceDigest: string, languageGroup = 'en-Latn') => ({
  organizationId: ORGANIZATION,
  propertyId: PROPERTY,
  languageGroup,
  voiceDigest,
})

describe('isCurrentVoice', () => {
  const currentDigest = digestResolvedReplyVoice(
    resolveVoice(BUILTIN_REPLY_VOICE, null, null),
    'en-Latn',
  )

  it('accepts the digest of the voice the business has now', async () => {
    const voice = api(vi.fn(async () => ({ accountVoice: null, propertyVoice: null })))
    await expect(voice.isCurrentVoice(TX, input(currentDigest))).resolves.toBe(true)
  })

  it('rejects a digest taken before the voice changed', async () => {
    const voice = api(vi.fn(async () => ({ accountVoice: null, propertyVoice: null })))
    await expect(voice.isCurrentVoice(TX, input('0'.repeat(64)))).resolves.toBe(false)
  })

  it('rejects when no voice record can be read', async () => {
    const voice = api(vi.fn(async () => null))
    await expect(voice.isCurrentVoice(TX, input(currentDigest))).resolves.toBe(false)
  })

  it('rejects a language group without a built-in voice without reading storage', async () => {
    const loader = vi.fn(async () => ({ accountVoice: null, propertyVoice: null }))
    await expect(
      api(loader).isCurrentVoice(TX, input(currentDigest, 'fr-Latn')),
    ).resolves.toBe(false)
    expect(loader).not.toHaveBeenCalled()
  })
})

describe('resolveLocalFrame', () => {
  const REVIEW = reviewId('20000000-0000-4000-8000-000000000001')
  const MARKER = 'RepKeyBodyMarker'

  function voiceWith(localized: StoredReplyVoice['localized']): StoredReplyVoice {
    return {
      organizationId: ORGANIZATION,
      propertyId: PROPERTY,
      version: 1,
      overriddenFields: [],
      localized,
    }
  }

  function localApi(
    voice: StoredReplyVoice | null,
    review: Partial<Review>,
    propertyName = 'Harbor House',
  ) {
    const repository = {
      loadSnapshot: vi.fn(async () => ({
        propertyName,
        defaultReplyLanguage: 'en-Latn-US',
        accountVoice: null,
        propertyVoice: voice,
        accountTemplates: [],
        propertyTemplates: [],
        visibility: [],
      })),
    } as unknown as ReplyLibraryRepository
    const reviews = {
      findById: vi.fn(async () => ({
        id: REVIEW,
        propertyId: PROPERTY,
        rating: 2,
        text: 'Check-in took forty minutes.',
        reviewerName: 'Anna K.',
        ...review,
      })),
    } as unknown as ReviewRepository
    return createAiReplyVoicePublicApi({ repository, reviews })
  }

  // The frame this api returned before it shared the v2 frame builder.
  function expectedFrame(
    voice: StoredReplyVoice | null,
    review: Pick<Review, 'rating' | 'text' | 'reviewerName'>,
    propertyName = 'Harbor House',
  ) {
    const resolved = resolveVoice(BUILTIN_REPLY_VOICE, null, voice)
    let rendered
    try {
      rendered = renderReply({
        body: MARKER,
        voice: resolved,
        languageGroup: 'en-Latn',
        rating: review.rating,
        hasText: Boolean(review.text?.trim()),
        reviewerDisplayName: review.reviewerName,
        propertyDisplayName: propertyName,
        choices: {
          closing: 0,
          signOff: 0,
          contactSentence: 0,
          emoji: 0,
          includeContact: true,
        },
      })
    } catch (error) {
      if (isReplyRenderError(error)) return null
      throw error
    }
    const markerAt = rendered.text.indexOf(MARKER)
    return {
      prefix: rendered.text.slice(0, markerAt).trim(),
      suffix: rendered.text.slice(markerAt + MARKER.length).trim(),
      voiceDigest: rendered.voiceDigest,
      reviewerDisplayName: review.reviewerName,
      contact: resolved.contact.value,
      signerName: resolved.signerName.value,
      signerTitle: resolved.signerTitle.value,
      businessName: resolved.businessNameShort.value?.trim() || propertyName,
    }
  }

  const input = {
    organizationId: ORGANIZATION,
    propertyId: PROPERTY,
    reviewId: REVIEW,
    languageGroup: 'en-Latn' as const,
  }

  const cases: ReadonlyArray<
    Readonly<{
      name: string
      voice?: StoredReplyVoice
      review: Partial<Review>
      propertyName?: string
    }>
  > = [
    { name: 'the built-in voice on a low rating', review: { rating: 1 } },
    {
      name: 'the built-in voice on a five-star rating without text',
      review: { rating: 5, text: null },
    },
    {
      name: 'a three-star review from an unnamed guest',
      review: { rating: 3, reviewerName: null },
    },
    {
      name: 'a closing the business wrote',
      voice: voiceWith({
        'en-Latn': { closings: { negative: ['Our door is always open.'] } },
      }),
      review: { rating: 2 },
    },
    {
      name: 'the property name used as the business name',
      review: { rating: 4 },
      propertyName: 'Lakeside Inn',
    },
  ]

  it.each(cases)('matches the earlier frame for $name', async (c) => {
    const voice = c.voice ?? null
    const review: Pick<Review, 'rating' | 'text' | 'reviewerName'> = {
      rating: 2,
      text: 'Check-in took forty minutes.',
      reviewerName: 'Anna K.',
      ...c.review,
    }
    const frame = await localApi(voice, review, c.propertyName).resolveLocalFrame(input)
    expect(frame).not.toBeNull()
    expect(frame).toEqual(expectedFrame(voice, review, c.propertyName))
  })

  it('leaves the draft unframed when the voice is too long to render', async () => {
    const voice = voiceWith({
      'en-Latn': { closings: { negative: ['x'.repeat(5000)] } },
    })
    expect(expectedFrame(voice, { rating: 2, text: 'a', reviewerName: null })).toBeNull()
    await expect(
      localApi(voice, { rating: 2, text: 'a', reviewerName: null }).resolveLocalFrame(
        input,
      ),
    ).resolves.toBeNull()
  })

  it('returns nothing for a review of another property', async () => {
    const otherProperty = propertyId('10000000-0000-4000-8000-000000000002')
    await expect(
      localApi(null, { propertyId: otherProperty }).resolveLocalFrame(input),
    ).resolves.toBeNull()
  })
})
