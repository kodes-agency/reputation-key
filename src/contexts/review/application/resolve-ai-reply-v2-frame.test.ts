import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { Review } from '../domain/types'
import { readAiReplyVoiceSnapshot } from './ai-reply-voice-snapshot'
import type {
  ReplyLibraryRepository,
  StoredReplyVoice,
} from './ports/reply-library.repository'
import type { ReviewRepository } from './ports/review.repository'
import { resolveAiReplyV2Frame } from './resolve-ai-reply-v2-frame'

const ORGANIZATION = organizationId('org-1')
const PROPERTY = propertyId('10000000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('10000000-0000-4000-8000-000000000002')
const REVIEW = reviewId('20000000-0000-4000-8000-000000000001')

function deps(
  options: Readonly<{
    reviewProperty?: typeof PROPERTY
    withReservation?: boolean
    rating?: number
    propertyVoice?: StoredReplyVoice
  }> = {},
) {
  const reserveAiFrame = vi.fn(async () => ({
    choices: {
      closing: 1,
      signOff: 0,
      contactSentence: 0,
      emoji: 0,
      includeContact: true,
    },
    closingOrder: [1, 0, 2],
  }))
  const repository: ReplyLibraryRepository = {
    loadSnapshot: vi.fn(async () => ({
      propertyName: 'Harbor House',
      defaultReplyLanguage: 'en-Latn-US',
      accountVoice: null,
      propertyVoice: options.propertyVoice ?? null,
      accountTemplates: [],
      propertyTemplates: [],
      visibility: [],
    })),
    saveVoice: vi.fn(),
    saveTemplate: vi.fn(),
    setHidden: vi.fn(),
    archiveCustomization: vi.fn(),
    ...(options.withReservation === false ? {} : { reserveAiFrame }),
  }
  const review = {
    id: REVIEW,
    propertyId: options.reviewProperty ?? PROPERTY,
    rating: options.rating ?? 2,
    text: 'Check-in took forty minutes.',
    reviewerName: 'Anna K.',
  } as Review
  const findById: ReviewRepository['findById'] = vi.fn(async () => review)
  const reviews = { findById } as Pick<ReviewRepository, 'findById'> as ReviewRepository
  return { repository, reviews, reserveAiFrame }
}

const INPUT = {
  organizationId: ORGANIZATION,
  propertyId: PROPERTY,
  reviewId: REVIEW,
  languageGroup: 'en-Latn',
  generationSeed: 'a'.repeat(64),
  nowEpochMillis: Date.UTC(2026, 9, 31),
}

describe('AI reply v2 frame resolution', () => {
  it('reads no voice for a language group without a built-in voice', async () => {
    const { repository, reviews } = deps()
    await expect(
      readAiReplyVoiceSnapshot(
        { repository, reviews },
        { ...INPUT, languageGroup: 'fr-Latn' },
      ),
    ).resolves.toBeNull()
    expect(repository.loadSnapshot).not.toHaveBeenCalled()
  })

  it('refuses a review that belongs to another property', async () => {
    const { repository, reviews } = deps({ reviewProperty: OTHER_PROPERTY })
    await expect(
      readAiReplyVoiceSnapshot({ repository, reviews }, INPUT),
    ).resolves.toBeNull()
  })

  it('builds no frame when the repository cannot reserve one', async () => {
    const { repository, reviews } = deps({ withReservation: false })
    await expect(
      resolveAiReplyV2Frame({ repository, reviews }, INPUT),
    ).resolves.toBeNull()
  })

  it('reserves frame options for the review band and builds the frame from them', async () => {
    const { repository, reviews, reserveAiFrame } = deps()
    const frame = await resolveAiReplyV2Frame({ repository, reviews }, INPUT)
    expect(reserveAiFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        ratingBand: 'negative',
        generationSeed: INPUT.generationSeed,
        optionCounts: expect.objectContaining({
          closing: 0,
          signOff: 3,
          contactSentence: 3,
        }),
      }),
    )
    expect(frame).not.toBeNull()
  })

  // The body ends by saying what the business will check; a built-in thank-you after it reads
  // as agreeing with the complaint.
  it.each([
    [1, 'negative'],
    [2, 'negative'],
    [3, 'threeStar'],
  ])('offers no built-in closing on a %i star review', async (rating, ratingBand) => {
    const { repository, reviews, reserveAiFrame } = deps({ rating })
    await resolveAiReplyV2Frame({ repository, reviews }, INPUT)
    expect(reserveAiFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        ratingBand,
        optionCounts: expect.objectContaining({ closing: 0 }),
      }),
    )
  })

  it('keeps the built-in closing on a five star review', async () => {
    const { repository, reviews, reserveAiFrame } = deps({ rating: 5 })
    await resolveAiReplyV2Frame({ repository, reviews }, INPUT)
    expect(reserveAiFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        optionCounts: expect.objectContaining({ closing: 3 }),
      }),
    )
  })

  it('keeps a closing the business wrote itself on a low rating', async () => {
    const { repository, reviews, reserveAiFrame } = deps({
      propertyVoice: {
        organizationId: ORGANIZATION,
        propertyId: PROPERTY,
        version: 1,
        overriddenFields: [],
        localized: {
          'en-Latn': { closings: { negative: ['Our door is always open.'] } },
        },
      },
    })
    await resolveAiReplyV2Frame({ repository, reviews }, INPUT)
    expect(reserveAiFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        optionCounts: expect.objectContaining({ closing: 1 }),
      }),
    )
  })
})

describe('saved AI body boundaries', () => {
  it('restores the accepted frame, including an omitted closing, without rotating it', async () => {
    const d = deps()
    const { resolveSavedReplyFrame } = await import('./resolve-ai-reply-v2-frame')
    const frame = await resolveAiReplyV2Frame(d, INPUT)
    const candidate = frame!.candidates.at(-1)!
    const text = [
      candidate.prefix,
      'We are sorry the arrival took so long.',
      candidate.suffix,
    ]
      .filter(Boolean)
      .join('\n\n')
    const reserveCalls = d.reserveAiFrame.mock.calls.length
    expect(
      await resolveSavedReplyFrame(d, {
        ...INPUT,
        voiceDigest: frame!.voiceDigest,
        choices: candidate.choices,
        text,
      }),
    ).toEqual({ prefix: candidate.prefix, suffix: candidate.suffix })
    expect(d.reserveAiFrame).toHaveBeenCalledTimes(reserveCalls)
    expect(
      await resolveSavedReplyFrame(d, {
        ...INPUT,
        voiceDigest: '0'.repeat(64),
        choices: candidate.choices,
        text,
      }),
    ).toBeNull()
  })
})
