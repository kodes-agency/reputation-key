import { describe, expect, it, vi } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type {
  PropertyReplyProfile,
  PropertyReplyTemplate,
  ReplyTemplateRepository,
} from '../ports/reply-template.repository'
import type { ReplyRepository } from '../ports/reply.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type { Reply, Review } from '../../domain/types'
import { draftReply, type ReplyDeps } from './reply-operations'
import {
  listReplyTemplates,
  loadReplyTemplate,
  renderReplyTemplate,
} from './reply-template-operations'

const NOW = new Date('2026-09-08T12:00:00.000Z')
const ORG = organizationId('70000000-0000-4000-8000-000000000001')
const PROPERTY = propertyId('70000000-0000-4000-8000-000000000002')
const REVIEW = reviewId('70000000-0000-4000-8000-000000000003')
const REPLY = replyId('70000000-0000-4000-8000-000000000004')
const USER = userId('70000000-0000-4000-8000-000000000005')

const MANAGER: AuthContext = {
  role: 'PropertyManager',
  organizationId: ORG,
  userId: USER,
}
const MEMBER: AuthContext = { ...MANAGER, role: 'Member' }

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: REVIEW,
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google',
    externalId: 'private-external-review-id',
    externalLocationId: 'private-location-id',
    googleConnectionId: null,
    reviewerName: 'Secret Reviewer',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Private review text that must never enter the template library response.',
    translatedText: null,
    languageCode: 'en-US',
    reviewedAt: NOW,
    expiresAt: NOW,
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: NOW,
    sourceUpdatedAt: null,
    firstFetchedAt: NOW,
    lastFetchedAt: NOW,
    contentExpiresAt: null,
    contentHash: null,
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 0,
    aiSourceByteLength: 64,
    aiSourceDigest: '0'.repeat(64),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeProfile(
  overrides: Partial<PropertyReplyProfile> = {},
): PropertyReplyProfile {
  return {
    id: '70000000-0000-4000-8000-000000000006',
    organizationId: ORG,
    propertyId: PROPERTY,
    greeting: 'Dear {guest_name},',
    signOffPositive: 'Warm regards,\nHotel Team',
    signOffNegative: 'Sincerely,\nGuest Relations',
    emojiAllowed: false,
    escalationContact: 'care@example.test',
    version: 3,
    updatedBy: USER,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeTemplate(
  overrides: Partial<PropertyReplyTemplate> = {},
): PropertyReplyTemplate {
  return {
    id: '70000000-0000-4000-8000-000000000007',
    organizationId: ORG,
    propertyId: PROPERTY,
    title: 'General appreciation',
    ratingMin: 4,
    ratingMax: 5,
    hasText: true,
    aspect: null,
    openLabel: null,
    languageTag: 'en-Latn',
    body: 'Thank you, {guest_name}. Contact {escalation_contact} if we can help. 🌟',
    enabled: true,
    version: 4,
    updatedBy: USER,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeStaffApi(): StaffPublicApi {
  return {
    getAccessiblePropertyIds: vi.fn(async () => [PROPERTY]),
    getAssignedPortals: vi.fn(async () => []),
  }
}

function makeRepository(
  options: {
    review?: Review
    profile?: PropertyReplyProfile | null
    templates?: readonly PropertyReplyTemplate[]
    defaultLanguage?: string | null
  } = {},
) {
  const review = options.review ?? makeReview()
  const templates = options.templates ?? [makeTemplate()]
  const repository = {
    findPropertyOrganization: vi.fn(async () => ORG),
    findProfile: vi.fn(async () => options.profile ?? makeProfile()),
    findApplicableTemplates: vi.fn(async () => templates),
    findEnabledTemplateById: vi.fn(
      async ({ templateId }: { templateId: string }) =>
        templates.find((template) => template.id === templateId) ?? null,
    ),
    readDefaultReplyLanguage: vi.fn(async () => options.defaultLanguage ?? 'en-Latn-US'),
    upsertProfile: vi.fn(),
    upsertTemplate: vi.fn(),
  } as unknown as ReplyTemplateRepository
  const reviewRepo = {
    findById: vi.fn(async () => review),
  } as unknown as ReviewRepository
  return { repository, reviewRepo, review }
}

function makeManualDraftDeps(review: Review) {
  const accept = vi.fn()
  const assertCurrentBinding = vi.fn()
  const providerRead = vi.fn()
  const upsert = vi.fn(
    async (candidate: Omit<Reply, 'createdAt' | 'updatedAt'>): Promise<Reply> => ({
      ...candidate,
      createdAt: NOW,
      updatedAt: NOW,
    }),
  )
  const deps = {
    replyRepo: {
      findInternalByReviewId: vi.fn(async () => null),
      upsert,
    } as unknown as ReplyRepository,
    reviewRepo: {
      findById: vi.fn(async () => review),
    } as unknown as ReviewRepository,
    staffPublicApi: makeStaffApi(),
    aiSuggestedDraftStore: { accept, assertCurrentBinding },
    googleReviewApi: { getReply: providerRead },
    clock: () => NOW,
    idGen: () => REPLY,
    queue: {},
    commandStore: {},
    googleReplyObservationStore: {},
  } as unknown as ReplyDeps
  return { deps, accept, assertCurrentBinding, providerRead, upsert }
}

describe('listReplyTemplates', () => {
  it('lists only the target language group and recommends its general template', async () => {
    const general = makeTemplate({ id: 'general', aspect: null })
    const room = makeTemplate({ id: 'room', title: 'Room praise', aspect: 'room' })
    const otherLanguage = makeTemplate({
      id: 'bulgarian',
      title: 'Bulgarian general',
      languageTag: 'bg-Cyrl',
    })
    const { repository, reviewRepo } = makeRepository({
      templates: [room, otherLanguage, general],
    })

    const result = await listReplyTemplates({
      repository,
      reviewRepo,
      staffPublicApi: makeStaffApi(),
    })({ reviewId: REVIEW, targetLanguage: { kind: 'review_language' } }, MANAGER)

    expect(repository.findApplicableTemplates).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: PROPERTY,
      rating: 5,
      hasText: true,
    })
    expect(result.groups).toEqual([
      {
        languageGroup: 'en-Latn',
        templates: [
          expect.objectContaining({ id: 'general', title: 'General appreciation' }),
          expect.objectContaining({ id: 'room', title: 'Room praise' }),
        ],
      },
    ])
    expect(result.recommendedTemplateId).toBe('general')
    expect(JSON.stringify(result)).not.toContain('Secret Reviewer')
    expect(JSON.stringify(result)).not.toContain('Private review text')
  })

  it('requires reply.manage before reading review or property data', async () => {
    const { repository, reviewRepo } = makeRepository()

    await expect(
      listReplyTemplates({ repository, reviewRepo, staffPublicApi: makeStaffApi() })(
        { reviewId: REVIEW, targetLanguage: { kind: 'property_default' } },
        MEMBER,
      ),
    ).rejects.toMatchObject({ code: 'unauthorized' })
    expect(reviewRepo.findById).not.toHaveBeenCalled()
    expect(repository.findApplicableTemplates).not.toHaveBeenCalled()
  })
})

describe('renderReplyTemplate', () => {
  it('applies greeting, positive sign-off, escalation contact, and emoji policy', () => {
    const rendered = renderReplyTemplate(makeTemplate(), makeProfile(), 5)

    expect(rendered).toBe(
      'Dear {guest_name},\n\nThank you, {guest_name}. Contact care@example.test if we can help.\n\nWarm regards,\nHotel Team',
    )
    expect(rendered).not.toContain('Secret Reviewer')
  })

  it('does not duplicate an existing greeting and uses the negative sign-off', () => {
    const rendered = renderReplyTemplate(
      makeTemplate({ body: 'Hello {guest_name},\n\nWe are sorry about {dish}.' }),
      makeProfile(),
      2,
    )

    expect(rendered).toBe(
      'Hello {guest_name},\n\nWe are sorry about {dish}.\n\nSincerely,\nGuest Relations',
    )
  })
})

describe('loadReplyTemplate', () => {
  it('saves through the manual draft path with library provenance and no AI/provider call', async () => {
    const review = makeReview()
    const template = makeTemplate()
    const { repository, reviewRepo } = makeRepository({ review, templates: [template] })
    const manual = makeManualDraftDeps(review)

    const result = await loadReplyTemplate({
      repository,
      reviewRepo,
      staffPublicApi: makeStaffApi(),
      draftReply: draftReply(manual.deps),
    })(
      {
        reviewId: REVIEW,
        templateId: template.id,
        targetLanguage: { kind: 'review_language' },
      },
      MANAGER,
    )

    expect(result).toMatchObject({
      id: REPLY,
      aiGenerated: false,
      templateId: template.id,
      templateVersion: 4,
      replyLanguageTag: 'en-Latn-US',
    })
    expect(result.text).toContain('{guest_name}')
    expect(result.text).not.toContain('Secret Reviewer')
    expect(manual.upsert).toHaveBeenCalledOnce()
    expect(manual.accept).not.toHaveBeenCalled()
    expect(manual.assertCurrentBinding).not.toHaveBeenCalled()
    expect(manual.providerRead).not.toHaveBeenCalled()
  })
})
