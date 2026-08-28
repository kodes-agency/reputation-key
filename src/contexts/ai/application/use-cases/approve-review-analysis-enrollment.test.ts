import { describe, expect, it, vi } from 'vitest'
import type { ReviewAnalysisEnrollmentStorePort } from '../ports/ai-review-analysis-enrollment.port'
import { createApproveReviewAnalysisEnrollment } from './approve-review-analysis-enrollment'

const INPUT = {
  enrollmentId: '31000000-0000-4000-8000-000000000101',
  expectedFence: {
    authorizationLineageId: '31000000-0000-4000-8000-000000000102',
    authorizationStateVersion: 3,
    sourceEpoch: 2,
    reviewAnalysisEpoch: 4,
    analysisStartSequence: 10_001,
  },
  approvedByOperatorId: 'beta-operator',
  approvalEvidenceDigest: 'a'.repeat(64),
  correlationId: '31000000-0000-4000-8000-000000000103',
  occurredAt: new Date('2026-08-28T06:00:00.000Z'),
} as const

describe('approve Review Analysis enrollment', () => {
  it('delegates one exact-fence approval and preserves its tagged result', async () => {
    const approveAssistedReplay = vi.fn(async () => ({
      status: 'approved' as const,
      enrollmentId: INPUT.enrollmentId,
    }))
    const approve = createApproveReviewAnalysisEnrollment({
      enrollments: {
        approveAssistedReplay,
      } as unknown as ReviewAnalysisEnrollmentStorePort,
    })

    await expect(approve(INPUT)).resolves.toEqual({
      status: 'approved',
      enrollmentId: INPUT.enrollmentId,
    })
    expect(approveAssistedReplay).toHaveBeenCalledWith(INPUT)
  })

  it.each([
    ['invalid enrollment id', { enrollmentId: 'not-a-uuid' }],
    [
      'invalid authorization lineage',
      {
        expectedFence: {
          ...INPUT.expectedFence,
          authorizationLineageId: 'not-a-uuid',
        },
      },
    ],
    [
      'invalid authorization state version',
      {
        expectedFence: {
          ...INPUT.expectedFence,
          authorizationStateVersion: 0,
        },
      },
    ],
    [
      'invalid source epoch',
      { expectedFence: { ...INPUT.expectedFence, sourceEpoch: -1 } },
    ],
    [
      'invalid Review Analysis epoch',
      { expectedFence: { ...INPUT.expectedFence, reviewAnalysisEpoch: 0 } },
    ],
    [
      'invalid analysis start sequence',
      { expectedFence: { ...INPUT.expectedFence, analysisStartSequence: -1 } },
    ],
    ['blank operator', { approvedByOperatorId: ' ' }],
    ['raw ticket instead of its digest', { approvalEvidenceDigest: 'TICKET-123' }],
    ['invalid correlation', { correlationId: 'not-a-uuid' }],
    ['invalid time', { occurredAt: new Date(Number.NaN) }],
    ['negative time', { occurredAt: new Date(-1) }],
  ])('refuses %s before reaching persistence', async (_label, override) => {
    const approveAssistedReplay = vi.fn()
    const approve = createApproveReviewAnalysisEnrollment({
      enrollments: {
        approveAssistedReplay,
      } as unknown as ReviewAnalysisEnrollmentStorePort,
    })

    await expect(approve({ ...INPUT, ...override })).resolves.toEqual({
      status: 'refused',
      reason: 'approval_evidence_invalid',
    })
    expect(approveAssistedReplay).not.toHaveBeenCalled()
  })
})
