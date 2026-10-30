import { describe, expect, it, vi } from 'vitest'
import '#/shared/auth/permissions'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { parseCanonicalReplyLanguageTag } from '#/shared/reply-language-catalogue'
import type { ReplyLibraryRepository } from '../ports/reply-library.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type { Reply, Review } from '../../domain/types'
import {
  listReplyTemplates,
  loadReplyTemplate,
} from './layered-reply-template-operations'

const NOW = new Date('2026-10-30T12:00:00.000Z')
const ORGANIZATION = organizationId('90000000-0000-4000-8000-000000000001')
const PROPERTY = propertyId('90000000-0000-4000-8000-000000000002')
const REVIEW = reviewId('90000000-0000-4000-8000-000000000003')
const USER = userId('90000000-0000-4000-8000-000000000004')
const ARABIC_TEMPLATE_ID = '90000000-0000-4000-8000-000000000005'
const MANAGER: AuthContext = {
  organizationId: ORGANIZATION,
  userId: USER,
  role: 'PropertyManager',
}

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: REVIEW,
    organizationId: ORGANIZATION,
    propertyId: PROPERTY,
    platform: 'google',
    externalId: 'external-review',
    externalLocationId: 'external-location',
    googleConnectionId: null,
    reviewerName: 'مريم',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 5,
    text: 'La estancia fue excelente y todo el personal fue muy amable y atento.',
    translatedText: null,
    languageCode: null,
    reviewedAt: NOW,
    expiresAt: NOW,
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: NOW,
    sourceUpdatedAt: NOW,
    firstFetchedAt: NOW,
    lastFetchedAt: NOW,
    contentExpiresAt: NOW,
    contentHash: null,
    sourceSeenGeneration: null,
    sourceEpoch: 1,
    sourceRevision: 1,
    analysisSequence: 1,
    aiSourceByteLength: 64,
    aiSourceDigest: '0'.repeat(64),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function dependencies(
  input: Readonly<{
    defaultReplyLanguage: string
    review?: Review
    withArabicTemplate?: boolean
    resolveLanguage?: 'es-Latn' | 'ar-Arab'
  }>,
) {
  const currentReview = input.review ?? review()
  const repository: ReplyLibraryRepository = {
    loadSnapshot: vi.fn(async () => ({
      propertyName: 'Harbor House',
      defaultReplyLanguage: input.defaultReplyLanguage,
      accountVoice: null,
      propertyVoice: null,
      accountTemplates: [],
      propertyTemplates: input.withArabicTemplate
        ? [
            {
              id: ARABIC_TEMPLATE_ID,
              organizationId: ORGANIZATION,
              propertyId: PROPERTY,
              builtinKey: null,
              basedOnTemplateId: null,
              basedOnBuiltinVersion: null,
              revisionId: '90000000-0000-4000-8000-000000000006',
              revision: 1,
              revisionCreatedAt: NOW,
              title: 'Arabic welcome',
              starsMin: 4,
              starsMax: 5,
              reviewKind: 'text' as const,
              topic: null,
              wordings: [
                {
                  key: '1',
                  languageGroup: 'ar-Arab',
                  body: 'شكرًا لكم على مشاركة تجربتكم الرائعة معنا.',
                },
              ],
            },
          ]
        : [],
      visibility: [],
    })),
    saveVoice: vi.fn(),
    saveTemplate: vi.fn(),
    setHidden: vi.fn(),
    archiveCustomization: vi.fn(),
  }
  const reviewRepo = {
    findById: vi.fn(async () => currentReview),
  } as unknown as ReviewRepository
  const staffPublicApi = {
    getAccessiblePropertyIds: vi.fn(async () => [PROPERTY]),
    getAssignedPortals: vi.fn(async () => []),
  } as StaffPublicApi
  const draftReply = vi.fn(
    async (draft): Promise<Reply> =>
      ({
        id: '90000000-0000-4000-8000-000000000007',
        reviewId: REVIEW,
        organizationId: ORGANIZATION,
        text: draft.text,
      }) as unknown as Reply,
  )
  const resolveReplyLanguage = vi.fn(async () => ({
    status: 'resolved' as const,
    language: parseCanonicalReplyLanguageTag(input.resolveLanguage ?? 'es-Latn')!,
  }))
  return { repository, reviewRepo, staffPublicApi, draftReply, resolveReplyLanguage }
}

describe('layered reply template language resolution', () => {
  it('lists Spanish built-ins for an explicit property-default target', async () => {
    const deps = dependencies({ defaultReplyLanguage: 'es-Latn' })

    const result = await listReplyTemplates(deps)(
      { reviewId: REVIEW, targetLanguage: { kind: 'property_default' } },
      MANAGER,
    )

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.languageGroup).toBe('es-Latn')
    expect(result.groups[0]?.templates[0]?.ref).toMatch(/^builtin:/u)
    expect(deps.resolveReplyLanguage).not.toHaveBeenCalled()
  })

  it('detects a Spanish review for a review-language target', async () => {
    const deps = dependencies({
      defaultReplyLanguage: 'en-Latn',
      resolveLanguage: 'es-Latn',
    })

    const result = await listReplyTemplates(deps)(
      { reviewId: REVIEW, targetLanguage: { kind: 'review_language' } },
      MANAGER,
    )

    expect(result.groups[0]?.languageGroup).toBe('es-Latn')
    expect(deps.resolveReplyLanguage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('estancia') }),
    )
  })

  it('lists a property-owned Arabic template without built-in Arabic wordings', async () => {
    const deps = dependencies({
      defaultReplyLanguage: 'ar-Arab',
      withArabicTemplate: true,
    })

    const result = await listReplyTemplates(deps)(
      { reviewId: REVIEW, targetLanguage: { kind: 'property_default' } },
      MANAGER,
    )

    expect(result.groups).toEqual([
      {
        languageGroup: 'ar-Arab',
        templates: [expect.objectContaining({ ref: `template:${ARABIC_TEMPLATE_ID}` })],
      },
    ])
  })

  it('loads the same detected Arabic template unframed', async () => {
    const deps = dependencies({
      defaultReplyLanguage: 'en-Latn',
      withArabicTemplate: true,
      resolveLanguage: 'ar-Arab',
    })

    const result = await loadReplyTemplate(deps)(
      {
        reviewId: REVIEW,
        ref: `template:${ARABIC_TEMPLATE_ID}`,
        targetLanguage: { kind: 'review_language' },
      },
      MANAGER,
    )

    expect(deps.draftReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'شكرًا لكم على مشاركة تجربتكم الرائعة معنا.',
        replyLanguageTag: 'ar-Arab',
      }),
      MANAGER,
    )
    expect(result.hasAlternativeWording).toBe(false)
  })
})
