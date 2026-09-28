import { describe, expect, it } from 'vitest'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import { parseCanonicalReplyLanguageTag } from '#/shared/ai-review-language-catalogue'
import {
  analysisExecutionBinding,
  analysisOperationIdentity,
  replyExecutionBinding,
  replyOperationIdentity,
} from './ai-operation-binding'

// Field-by-field pins of both bindings live with the use cases that claim them
// (generate-reply-suggestion.test.ts, analyze-review-event.test.ts). These pin
// what separates the two kinds of operation.

const ORGANIZATION_ID = organizationId('ai-operation-binding-test')
const PROPERTY_ID = propertyId('73000000-0000-4000-8000-000000000101')
const REVIEW_ID = reviewId('73000000-0000-4000-8000-000000000102')
const ACTOR_USER_ID = userId('73000000-0000-4000-8000-000000000103')
const EVENT_ENVELOPE_ID = '73000000-0000-4000-8000-000000000104'

const operationProfile = (profileVersion: string) => {
  const profile = AI_OPERATION_PROFILES.find(
    (candidate) => candidate.profileVersion === profileVersion,
  )
  if (profile === undefined)
    throw new Error(`unknown operation profile ${profileVersion}`)
  return profile
}

const SHARED_FACTS = {
  authorization: {
    noticeVersion: 'notice-v1',
    noticeDigest: 'a'.repeat(64),
    redactionProfileFamily: 'gbp-review-global-v1',
    providerDeploymentProfileVersion: 'private-beta-global-v1',
  },
  authorizationLineageId: '73000000-0000-4000-8000-000000000105',
  evaluatedLanguage: 'en-Latn',
  reviewedAtEpochMillis: 1_000,
  profile: {
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    countryCode: 'US',
    timezone: 'America/New_York',
    processingRegion: 'global' as const,
    routingPolicyVersion: 1,
    sourceEpoch: 2,
    profileVersion: 3,
    lifecycleState: 'active' as const,
  },
  stopFence: {
    globalControlId: '73000000-0000-4000-8000-000000000111',
    globalGeneration: 1,
    providerControlId: '73000000-0000-4000-8000-000000000112',
    providerGeneration: 1,
    capabilityControlId: '73000000-0000-4000-8000-000000000113',
    capabilityGeneration: 1,
  },
}

const REPLY_REQUEST = {
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  reviewId: REVIEW_ID,
  actorUserId: ACTOR_USER_ID,
  tone: 'professional' as const,
  expectedSourceEpoch: 2,
  expectedSourceRevision: 5,
}

const ANALYSIS_EVENT = {
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  reviewId: REVIEW_ID,
  eventEnvelopeId: EVENT_ENVELOPE_ID,
  sourceEpoch: 2,
  sourceRevision: 5,
  analysisSequence: 7,
}

/** Fences only a reply draft is bound to. */
const REPLY_ONLY_FENCES = [
  'concreteReplyLanguage',
  'replyLanguageVerifierDigest',
  'languageScriptConsistencyDigest',
  'zhOrthographyVerifierDigest',
  'outputLeakageProfileVersion',
  'outputLeakageProfileDigest',
  'replyTemplateCatalogueVersion',
  'replyTemplateCatalogueDigest',
] as const

describe('AI operation binding', () => {
  it('binds a reply draft to every reply-only fence and to the Brand Profile', () => {
    const binding = replyExecutionBinding({
      ...SHARED_FACTS,
      input: REPLY_REQUEST,
      operationProfile: operationProfile('reply-suggestion-v1'),
      concreteReplyLanguage: parseCanonicalReplyLanguageTag('en-Latn')!,
      brandProfile: { version: 7, displayNameDigest: 'b'.repeat(64) },
      replyDraftingEpoch: 4,
      baseReplyStateRevision: 3,
    })

    for (const fence of REPLY_ONLY_FENCES) expect(binding[fence]).not.toBeNull()
    expect(binding).toMatchObject({
      capabilityFence: {
        capability: 'reply_drafting',
        replyDraftingEpoch: 4,
        baseReplyStateRevision: 3,
      },
      replyBrandProfileVersion: 7,
      replyBrandDisplayNameDigest: 'b'.repeat(64),
      aiSubjectHmacKeyVersion: null,
      operationProfileVersion: 'reply-suggestion-v1',
      capabilityRuntimeProfileVersion: 'reply-drafting-runtime-v1',
    })
  })

  it('keeps every reply-only fence null for a review analysis and names no Brand Profile', () => {
    const binding = analysisExecutionBinding({
      ...SHARED_FACTS,
      input: ANALYSIS_EVENT,
      operationProfile: operationProfile('review-analysis-v2'),
      reviewAnalysisEpoch: 2,
      subjectHmacKeyVersion: 'ai-subject-hmac-v1',
    })

    for (const fence of REPLY_ONLY_FENCES) expect(binding[fence]).toBeNull()
    expect(binding).not.toHaveProperty('replyBrandProfileVersion')
    expect(binding).not.toHaveProperty('replyBrandDisplayNameDigest')
    expect(binding).toMatchObject({
      capabilityFence: { capability: 'review_analysis', reviewAnalysisEpoch: 2 },
      aiSubjectHmacKeyVersion: 'ai-subject-hmac-v1',
      operationProfileVersion: 'review-analysis-v2',
      capabilityRuntimeProfileVersion: 'review-analysis-runtime-v1',
    })
  })

  it('names the manager on a reply draft and the event consumer on an analysis', () => {
    expect(replyOperationIdentity(REPLY_REQUEST, 1_000, 3)).toMatchObject({
      command: 'reply',
      capability: 'reply_drafting',
      actorId: ACTOR_USER_ID,
      systemPrincipal: null,
      sourceEpoch: 2,
      sourceRevision: 5,
      baseReplyStateRevision: 3,
    })
    expect(
      analysisOperationIdentity(
        ANALYSIS_EVENT,
        { digest: 'c'.repeat(64), keyVersion: 'ai-subject-hmac-v1' },
        1_000,
      ),
    ).toMatchObject({
      command: 'analysis',
      capability: 'review_analysis',
      actorId: null,
      systemPrincipal: 'review_event_consumer',
      originEventId: EVENT_ENVELOPE_ID,
      subjectHmac: 'c'.repeat(64),
      subjectHmacKeyVersion: 'ai-subject-hmac-v1',
      analysisSequence: 7,
    })
  })
})
