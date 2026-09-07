import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiControlPort } from '../ports/ai-control.port'
import type {
  ReviewAnalysisEnrollmentHead,
  ReviewAnalysisEnrollmentStorePort,
} from '../ports/ai-review-analysis-enrollment.port'
import { EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST } from '../ports/ai-review-analysis-enrollment.port'
import { createAdvanceReviewAnalysisEnrollments } from './advance-review-analysis-enrollments'

const ORGANIZATION_ID = organizationId('ai-enrollment-test')
const PROPERTY_ID = propertyId('8f5508e5-2030-4f11-84aa-529e6bc7f93d')
const ENROLLMENT_ID = 'ee5d7ed4-e676-4f59-8dc8-bf966f584540'
const LINEAGE_ID = 'c16545a0-5915-4f9f-a31b-b00754464f52'
const NOW = new Date('2026-08-27T08:00:00.000Z')

const HEAD: ReviewAnalysisEnrollmentHead = {
  id: ENROLLMENT_ID,
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  fence: {
    authorizationLineageId: LINEAGE_ID,
    authorizationStateVersion: 4,
    sourceEpoch: 2,
    reviewAnalysisEpoch: 3,
    analysisStartSequence: 40,
  },
  providerDeploymentProfileVersion: 'private-beta-global-v1',
  state: 'queued',
}

function authorization(
  overrides: Partial<
    Awaited<ReturnType<AiAuthorizationPort['readMerchantAuthorization']>> & object
  > = {},
): NonNullable<Awaited<ReturnType<AiAuthorizationPort['readMerchantAuthorization']>>> {
  return {
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    state: 'enabled',
    stateVersion: 4,
    authorizationLineageId: LINEAGE_ID,
    authorizedSourceEpoch: 2,
    capabilities: ['review_analysis'],
    capabilityRuntimeProfileVersions: {
      review_analysis: 'review-analysis-runtime-v1',
    },
    capabilityEpochs: {
      review_analysis: { epoch: 3, changedAtEpochMillis: NOW.getTime() },
      reply_drafting: { epoch: 1, changedAtEpochMillis: NOW.getTime() },
      property_trends: { epoch: 1, changedAtEpochMillis: NOW.getTime() },
    },
    reviewAnalysisStartSequence: 40,
    noticeVersion: 'merchant-ai-notice-v2',
    noticeDigest: 'a'.repeat(64),
    sourcePolicyId: 'review-ai-source-v1',
    sourceCanonicalizerDigest: 'b'.repeat(64),
    redactionProfileFamily: 'review-redaction-v1',
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    ...overrides,
  }
}

function harness(
  options: Readonly<{
    currentAuthorization?: ReturnType<typeof authorization> | null
    controlsEnabled?: boolean
    reconcileStatus?: Awaited<ReturnType<ReviewAnalysisEnrollmentStorePort['reconcile']>>
  }> = {},
) {
  const readMerchantAuthorization = vi.fn(async () =>
    options.currentAuthorization === undefined
      ? authorization()
      : options.currentAuthorization,
  )
  const readHeads = vi.fn(async () =>
    options.controlsEnabled === false
      ? []
      : [
          {
            scope: { kind: 'global' as const },
            controlId: '1b9202aa-451e-4fc0-90e7-ae4c74902c77',
            generation: 1,
            executionState: 'enabled' as const,
            admissionState: 'accepting' as const,
            updatedAtEpochMillis: NOW.getTime(),
          },
          {
            scope: {
              kind: 'provider_deployment_profile' as const,
              providerDeploymentProfileVersion: 'private-beta-global-v1',
            },
            controlId: '174c47b0-e9e8-4f90-97c2-fcb8b7a55f71',
            generation: 1,
            executionState: 'enabled' as const,
            admissionState: 'accepting' as const,
            updatedAtEpochMillis: NOW.getTime(),
          },
          {
            scope: {
              kind: 'capability' as const,
              capability: 'review_analysis' as const,
            },
            controlId: 'da3b485b-39aa-4c70-896f-2b66c19e82d1',
            generation: 1,
            executionState: 'enabled' as const,
            admissionState: 'accepting' as const,
            updatedAtEpochMillis: NOW.getTime(),
          },
        ],
  )
  const reconcile = vi.fn(async () =>
    options.reconcileStatus === undefined
      ? ({
          status: 'replay_started' as const,
          runId: '43f914cd-f05d-4434-a377-031840236e67',
          pinnedRevisionCount: 17,
        } as const)
      : options.reconcileStatus,
  )
  const markSuperseded = vi.fn(async () => true)
  const store: ReviewAnalysisEnrollmentStorePort = {
    applyAuthorizationLifecycle: async () => {
      throw new Error('not used')
    },
    listActionable: async () => [HEAD],
    reconcile,
    approveAssistedReplay: async () => {
      throw new Error('not used')
    },
    markSuperseded,
    readCurrent: async () => null,
  }
  return {
    advance: createAdvanceReviewAnalysisEnrollments({
      authorization: { readMerchantAuthorization } as AiAuthorizationPort,
      control: { readHeads, transition: async () => null } as AiControlPort,
      enrollments: store,
      nowEpochMillis: () => NOW.getTime(),
    }),
    readMerchantAuthorization,
    readHeads,
    reconcile,
    markSuperseded,
  }
}

describe('advance Review Analysis first-enablement enrollment', () => {
  it('keeps enrollment queued while live provider execution is dark', async () => {
    const test = harness({ controlsEnabled: false })

    await expect(test.advance.sweep()).resolves.toEqual({
      enrollmentsVisited: 1,
      runtimeBlocked: 1,
      replaysStarted: 0,
      revisionsPinned: 0,
      waitingForReplay: 0,
      enrollmentsCaughtUp: 0,
      enrollmentsSuperseded: 0,
      enrollmentsStalled: 0,
      batchFull: false,
    })
    expect(test.reconcile).not.toHaveBeenCalled()
    expect(test.markSuperseded).not.toHaveBeenCalled()
  })

  it('starts one set-based revision-pinned replay for the exact authorization fence', async () => {
    const test = harness()

    const result = await test.advance.sweep()

    expect(result.replaysStarted).toBe(1)
    expect(result.revisionsPinned).toBe(17)
    expect(test.reconcile).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
      organizationId: ORGANIZATION_ID,
      expectedFence: HEAD.fence,
      correlationId: ENROLLMENT_ID,
      occurredAt: NOW,
    })
  })

  it('supersedes a queued enrollment whose authorization generation moved', async () => {
    const test = harness({
      currentAuthorization: authorization({ stateVersion: 5 }),
    })

    const result = await test.advance.sweep()

    expect(result.enrollmentsSuperseded).toBe(1)
    expect(test.markSuperseded).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
      organizationId: ORGANIZATION_ID,
      expectedFence: HEAD.fence,
      reason: 'authorization_changed',
      occurredAt: NOW,
    })
    expect(test.readHeads).not.toHaveBeenCalled()
    expect(test.reconcile).not.toHaveBeenCalled()
  })

  it('reports zero-review caught-up evidence without opening a replay run', async () => {
    const test = harness({
      reconcileStatus: {
        status: 'caught_up',
        eligibleRevisionCount: 0,
        caughtUpAnalysisSequence: 40,
        revisionSetDigest: EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST,
      },
    })

    const result = await test.advance.sweep()

    expect(result.enrollmentsCaughtUp).toBe(1)
    expect(result.replaysStarted).toBe(0)
    expect(result.revisionsPinned).toBe(0)
  })
})
