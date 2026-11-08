import { describe, expect, it, vi } from 'vitest'
import {
  createInboxReviewAnalysisReader,
  inboxReadyV3Of,
} from './get-inbox-review-analysis.server'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import type { AiReviewSourcePort } from '#/contexts/review/application/public-api'
type AiReviewCurrentSourceResult = Awaited<
  ReturnType<AiReviewSourcePort['readCurrentSource']>
>
type AnalysisRead = Awaited<
  ReturnType<Parameters<typeof createInboxReviewAnalysisReader>[0]['readReviewAnalysis']>
>

const AT = 1_793_000_000_000

describe('inboxReadyV3Of', () => {
  it('keeps what the Inbox draws and names the cited sentences as its own numbers', () => {
    const read = inboxReadyV3Of({
      analysisSequence: 7,
      sentiment: 'mixed',
      attention: 'high',
      urgentReason: 'safety',
      generatedAtEpochMillis: AT,
      mentions: [
        {
          mentionOrdinal: 0,
          topic: 'facilities_equipment',
          polarity: 'negative',
          strength: 'strong',
          thing: 'air conditioning',
          issue: 'not working',
          issueGroupId: 'a0000000-0000-4000-8000-000000000001',
          sentences: [2, 3],
          namesPerson: null,
          correction: null,
        },
        {
          mentionOrdinal: 1,
          topic: 'staff_service',
          polarity: 'positive',
          strength: 'mild',
          thing: null,
          issue: null,
          issueGroupId: null,
          sentences: [1],
          namesPerson: 'team_member',
          correction: { kind: 'remove_topic', correctedAtEpochMillis: AT },
        },
      ],
    })

    expect(read).toEqual({
      status: 'ready_v3',
      analysisSequence: 7,
      sentiment: 'mixed',
      attention: 'high',
      urgentReason: 'safety',
      generatedAtEpochMillis: AT,
      mentions: [
        {
          mentionOrdinal: 0,
          topic: 'facilities_equipment',
          polarity: 'negative',
          strength: 'strong',
          thing: 'air conditioning',
          issue: 'not working',
          issueGroupId: 'a0000000-0000-4000-8000-000000000001',
          sentenceNumbers: [2, 3],
          namesPerson: null,
          correction: null,
        },
        {
          mentionOrdinal: 1,
          topic: 'staff_service',
          polarity: 'positive',
          strength: 'mild',
          thing: null,
          issue: null,
          issueGroupId: null,
          sentenceNumbers: [1],
          namesPerson: 'team_member',
          correction: { kind: 'remove_topic', correctedAtEpochMillis: AT },
        },
      ],
    })
  })

  it('passes a reading that names nothing on as one', () => {
    expect(
      inboxReadyV3Of({
        analysisSequence: 1,
        sentiment: 'neutral',
        attention: 'low',
        urgentReason: null,
        generatedAtEpochMillis: AT,
        mentions: [],
      }).mentions,
    ).toEqual([])
  })
})

const request = {
  organizationId: organizationId('org-1'),
  propertyId: propertyId('property-1'),
  reviewId: reviewId('review-1'),
  actor: {
    organizationId: organizationId('org-1'),
    userId: userId('user-1'),
    role: 'AccountAdmin' as const,
  },
}
const current: AiReviewCurrentSourceResult = {
  status: 'available',
  source: { ...request, sourceEpoch: 2, sourceRevision: 3, analysisSequence: 4 },
}

const currentness = {
  sourceEpoch: 2,
  sourceRevision: 3,
  analysisSequence: 4,
  reviewAnalysisEpoch: 1,
  propertyProfileVersion: 1,
  analysisProfileVersion: 'profile-1',
}
const noAnalysis = { ...currentness, status: 'none' as const }

function setup(
  source: AiReviewCurrentSourceResult = current,
  analysis: AnalysisRead = noAnalysis,
) {
  const readCurrentSource = vi.fn(async () => source)
  const readReviewAnalysis = vi.fn(async () => analysis)
  const read = createInboxReviewAnalysisReader({ readCurrentSource, readReviewAnalysis })
  return { read, readCurrentSource, readReviewAnalysis }
}

describe('current Inbox review analysis', () => {
  it.each([
    { status: 'not_found' as const },
    {
      ...current,
      source: { ...current.source, propertyId: propertyId('another-property') },
    },
  ])('withholds analysis for an absent or foreign-property source', async (source) => {
    const { read, readReviewAnalysis } = setup(source)
    await expect(read(request)).resolves.toEqual({ status: 'none' })
    expect(readReviewAnalysis).not.toHaveBeenCalled()
  })

  it('binds the analysis read to the current source and preserves the actor', async () => {
    const { read, readCurrentSource, readReviewAnalysis } = setup()
    await expect(read(request)).resolves.toEqual(noAnalysis)
    expect(readCurrentSource).toHaveBeenCalledWith({
      organizationId: request.organizationId,
      reviewId: request.reviewId,
    })
    expect(readReviewAnalysis).toHaveBeenCalledWith({
      ...request,
      sourceEpoch: 2,
      sourceRevision: 3,
      analysisSequence: 4,
    })
  })

  it('propagates a failed source read without requesting analysis', async () => {
    const { read, readCurrentSource, readReviewAnalysis } = setup()
    const failure = new Error('source unavailable')
    readCurrentSource.mockRejectedValueOnce(failure)
    await expect(read(request)).rejects.toBe(failure)
    expect(readReviewAnalysis).not.toHaveBeenCalled()
  })
})

describe('analysis delivery shapes', () => {
  it.each<AnalysisRead>([
    { status: 'disabled' },
    noAnalysis,
    { ...currentness, status: 'unavailable', reason: 'language_not_supported' },
  ])('keeps a $status result unchanged', async (analysis) => {
    await expect(setup(current, analysis).read(request)).resolves.toEqual(analysis)
  })

  it.each([null, 'service recovery'])(
    'preserves the older reading with issue label %s',
    async (issueLabel) => {
      const analysis: AnalysisRead = {
        ...currentness,
        status: 'ready',
        sentiment: 'negative',
        primaryCategory: 'service',
        aspects: [{ aspect: 'service', polarity: 'negative', intensity: -80 }],
        attention: 'high',
        issueLabel,
        generatedAtEpochMillis: AT,
      }
      await expect(setup(current, analysis).read(request)).resolves.toEqual({
        status: 'ready',
        sentiment: 'negative',
        primaryCategory: 'service',
        aspects: [{ aspect: 'service', polarity: 'negative', intensity: -80 }],
        attention: 'high',
        ...(issueLabel === null ? {} : { issueLabel }),
        generatedAtEpochMillis: AT,
      })
    },
  )

  it('delivers the current v3 reading through the same mention mapping', async () => {
    const analysis: Extract<AnalysisRead, { status: 'ready_v3' }> = {
      ...currentness,
      status: 'ready_v3',
      sentiment: 'mixed',
      attention: 'urgent',
      urgentReason: 'safety',
      mentions: [],
      generatedAtEpochMillis: AT,
    }
    await expect(setup(current, analysis).read(request)).resolves.toEqual({
      status: 'ready_v3',
      analysisSequence: 4,
      sentiment: 'mixed',
      attention: 'urgent',
      urgentReason: 'safety',
      mentions: [],
      generatedAtEpochMillis: AT,
    })
  })
})
