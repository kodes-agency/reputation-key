import { describe, expect, it } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiControlPort } from '../ports/ai-control.port'
import type {
  ReviewAnalysisEnrollmentEvidence,
  ReviewAnalysisEnrollmentStorePort,
} from '../ports/ai-review-analysis-enrollment.port'
import { EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST } from '../ports/ai-review-analysis-enrollment.port'
import { createReadReviewAnalysisEnrollmentReadiness } from './read-review-analysis-enrollment-readiness'

const ORGANIZATION_ID = organizationId('ai-enrollment-readiness')
const PROPERTY_ID = propertyId('c4eff4df-b7bb-4b7a-88ea-596262f24256')
const LINEAGE_ID = '14e4d3ca-74c4-46ee-bf15-1dfd9435f1e9'

const FENCE = {
  authorizationLineageId: LINEAGE_ID,
  authorizationStateVersion: 6,
  sourceEpoch: 4,
  reviewAnalysisEpoch: 8,
  analysisStartSequence: 25,
} as const

function authorization(state: 'enabled' | 'disabled' = 'enabled') {
  return {
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    state,
    stateVersion: 6,
    authorizationLineageId: state === 'enabled' ? LINEAGE_ID : null,
    authorizedSourceEpoch: 4,
    capabilities: state === 'enabled' ? (['review_analysis'] as const) : [],
    capabilityRuntimeProfileVersions:
      state === 'enabled'
        ? ({ review_analysis: 'review-analysis-runtime-v1' } as const)
        : {},
    capabilityEpochs: {
      review_analysis: { epoch: 8, changedAtEpochMillis: 1 },
      reply_drafting: { epoch: 1, changedAtEpochMillis: 1 },
      property_trends: { epoch: 1, changedAtEpochMillis: 1 },
    },
    reviewAnalysisStartSequence: 25,
    noticeVersion: 'merchant-ai-notice-v2',
    noticeDigest: 'a'.repeat(64),
    sourcePolicyId: 'review-ai-source-v1',
    sourceCanonicalizerDigest: 'b'.repeat(64),
    redactionProfileFamily: 'review-redaction-v1',
    providerDeploymentProfileVersion: 'private-beta-global-v1',
  }
}

function evidence(
  overrides: Partial<ReviewAnalysisEnrollmentEvidence> = {},
): ReviewAnalysisEnrollmentEvidence {
  return {
    id: 'c810f30d-169d-40e2-9816-c98f34ff07d0',
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    fence: FENCE,
    state: 'queued',
    triggerEventEnvelopeId: '280931cc-b4dd-42d5-9659-988405b80faa',
    snapshotRevisionCount: 1,
    snapshotRevisionSetDigest: 'b'.repeat(64),
    snapshotCapturedAtEpochMillis: 5,
    safetyCeiling: 10_000,
    assistedApprovalRequired: false,
    assistedApproval: null,
    enrolledRevisionCount: 0,
    caughtUpEligibleRevisionCount: null,
    caughtUpAnalysisSequence: null,
    caughtUpRevisionSetDigest: null,
    caughtUpAtEpochMillis: null,
    terminalReason: null,
    ...overrides,
  }
}

function read(
  options: Readonly<{
    currentAuthorization?: ReturnType<typeof authorization> | null
    currentEvidence?: ReviewAnalysisEnrollmentEvidence | null
    controlsEnabled?: boolean
  }> = {},
) {
  const authorizationPort: AiAuthorizationPort = {
    readMerchantAuthorization: async () =>
      options.currentAuthorization === undefined
        ? authorization()
        : options.currentAuthorization,
  }
  const control: AiControlPort = {
    readHeads: async () =>
      options.controlsEnabled === false
        ? []
        : [
            {
              scope: { kind: 'global' as const },
              controlId: 'e19619d8-4cbf-43b4-9537-133e4b4315f2',
              generation: 1,
              executionState: 'enabled' as const,
              admissionState: 'accepting' as const,
              updatedAtEpochMillis: 1,
            },
            {
              scope: {
                kind: 'provider_deployment_profile' as const,
                providerDeploymentProfileVersion: 'private-beta-global-v1',
              },
              controlId: '47acc8e8-8a64-4601-be43-029423bd0996',
              generation: 1,
              executionState: 'enabled' as const,
              admissionState: 'accepting' as const,
              updatedAtEpochMillis: 1,
            },
            {
              scope: {
                kind: 'capability' as const,
                capability: 'review_analysis' as const,
              },
              controlId: '8f19ec57-973d-468b-9e40-151f45d904c9',
              generation: 1,
              executionState: 'enabled' as const,
              admissionState: 'accepting' as const,
              updatedAtEpochMillis: 1,
            },
          ],
    transition: async () => null,
  }
  const enrollments: ReviewAnalysisEnrollmentStorePort = {
    applyAuthorizationLifecycle: async () => {
      throw new Error('not used')
    },
    listActionable: async () => [],
    reconcile: async () => {
      throw new Error('not used')
    },
    approveAssistedReplay: async () => {
      throw new Error('not used')
    },
    markSuperseded: async () => false,
    readCurrent: async () =>
      options.currentEvidence === undefined ? evidence() : options.currentEvidence,
  }
  return createReadReviewAnalysisEnrollmentReadiness({
    authorization: authorizationPort,
    control,
    enrollments,
  })
}

describe('Review Analysis enrollment readiness', () => {
  it('does not imply readiness when Review Analysis is not authorized', async () => {
    await expect(
      read({ currentAuthorization: authorization('disabled') })({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
      }),
    ).resolves.toEqual({ status: 'disabled' })
  })

  it('names a missing durable trigger for the current authorization fence', async () => {
    await expect(
      read({ currentEvidence: null })({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
      }),
    ).resolves.toEqual({ status: 'preparing', reason: 'trigger_pending' })
  })

  it('keeps a queued trigger visibly blocked while provider execution is dark', async () => {
    await expect(
      read({ controlsEnabled: false })({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
      }),
    ).resolves.toEqual({ status: 'preparing', reason: 'runtime_blocked' })
  })

  it('names a complete over-ceiling snapshot and never reports it as runtime work', async () => {
    await expect(
      read({
        controlsEnabled: false,
        currentEvidence: evidence({
          state: 'awaiting_assisted_approval',
          snapshotRevisionCount: 10_001,
          safetyCeiling: 10_000,
          assistedApprovalRequired: true,
        }),
      })({ organizationId: ORGANIZATION_ID, propertyId: PROPERTY_ID }),
    ).resolves.toEqual({
      status: 'preparing',
      reason: 'assisted_approval_required',
      snapshotRevisionCount: 10_001,
      safetyCeiling: 10_000,
    })
  })

  it('returns the durable exact-revision caught-up evidence', async () => {
    const caughtUpAt = Date.parse('2026-08-27T08:15:00.000Z')
    const digest = 'c'.repeat(64)

    await expect(
      read({
        currentEvidence: evidence({
          state: 'caught_up',
          enrolledRevisionCount: 42,
          caughtUpEligibleRevisionCount: 39,
          caughtUpAnalysisSequence: 71,
          caughtUpRevisionSetDigest: digest,
          caughtUpAtEpochMillis: caughtUpAt,
          terminalReason: 'eligible_revision_set_caught_up',
        }),
      })({ organizationId: ORGANIZATION_ID, propertyId: PROPERTY_ID }),
    ).resolves.toEqual({
      status: 'ready',
      fence: FENCE,
      snapshotRevisionCount: 1,
      snapshotRevisionSetDigest: 'b'.repeat(64),
      snapshotCapturedAtEpochMillis: 5,
      enrolledRevisionCount: 42,
      eligibleRevisionCount: 39,
      caughtUpAnalysisSequence: 71,
      revisionSetDigest: digest,
      caughtUpAtEpochMillis: caughtUpAt,
    })
  })

  it('proves a zero-review property ready with the canonical empty-set digest', async () => {
    const caughtUpAt = Date.parse('2026-08-27T08:20:00.000Z')

    await expect(
      read({
        currentEvidence: evidence({
          state: 'caught_up',
          snapshotRevisionCount: 0,
          snapshotRevisionSetDigest: EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST,
          snapshotCapturedAtEpochMillis: 5,
          enrolledRevisionCount: 0,
          caughtUpEligibleRevisionCount: 0,
          caughtUpAnalysisSequence: FENCE.analysisStartSequence,
          caughtUpRevisionSetDigest: EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST,
          caughtUpAtEpochMillis: caughtUpAt,
          terminalReason: 'eligible_revision_set_caught_up',
        }),
      })({ organizationId: ORGANIZATION_ID, propertyId: PROPERTY_ID }),
    ).resolves.toEqual({
      status: 'ready',
      fence: FENCE,
      snapshotRevisionCount: 0,
      snapshotRevisionSetDigest: EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST,
      snapshotCapturedAtEpochMillis: 5,
      enrolledRevisionCount: 0,
      eligibleRevisionCount: 0,
      caughtUpAnalysisSequence: FENCE.analysisStartSequence,
      revisionSetDigest: EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST,
      caughtUpAtEpochMillis: caughtUpAt,
    })
  })

  it.each([
    {
      label: 'an arbitrary digest for an empty enrollment snapshot',
      override: {
        snapshotRevisionCount: 0,
        snapshotRevisionSetDigest: 'f'.repeat(64),
      },
    },
    {
      label: 'an enrollment snapshot captured after caught-up verification',
      override: { snapshotCapturedAtEpochMillis: 11 },
    },
    {
      label: 'a negative enrollment snapshot capture time',
      override: { snapshotCapturedAtEpochMillis: -1 },
    },
    {
      label: 'an arbitrary digest for an empty population',
      override: {
        caughtUpEligibleRevisionCount: 0,
        caughtUpRevisionSetDigest: 'f'.repeat(64),
      },
    },
    {
      label: 'the empty-set digest for a non-empty population',
      override: {
        caughtUpEligibleRevisionCount: 1,
        caughtUpRevisionSetDigest: EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST,
      },
    },
    {
      label: 'a caught-up row without the exact terminal proof',
      override: { terminalReason: 'run_exhausted' },
    },
    {
      label: 'a verification sequence behind the authorization boundary',
      override: {
        caughtUpAnalysisSequence: FENCE.analysisStartSequence - 1,
      },
    },
    {
      label: 'a negative caught-up verification time',
      override: { caughtUpAtEpochMillis: -1 },
    },
  ])('fails closed for $label', async ({ override }) => {
    await expect(
      read({
        currentEvidence: evidence({
          state: 'caught_up',
          enrolledRevisionCount: 1,
          caughtUpEligibleRevisionCount: 1,
          caughtUpAnalysisSequence: FENCE.analysisStartSequence,
          caughtUpRevisionSetDigest: 'a'.repeat(64),
          caughtUpAtEpochMillis: 10,
          terminalReason: 'eligible_revision_set_caught_up',
          ...override,
        }),
      })({ organizationId: ORGANIZATION_ID, propertyId: PROPERTY_ID }),
    ).resolves.toEqual({
      status: 'unavailable',
      reason: 'enrollment_stalled',
    })
  })

  it('never treats a previous authorization generation as current readiness', async () => {
    await expect(
      read({
        currentEvidence: evidence({
          state: 'caught_up',
          fence: { ...FENCE, authorizationStateVersion: 5 },
          caughtUpEligibleRevisionCount: 1,
          caughtUpAnalysisSequence: 30,
          caughtUpRevisionSetDigest: 'd'.repeat(64),
          caughtUpAtEpochMillis: 10,
        }),
      })({ organizationId: ORGANIZATION_ID, propertyId: PROPERTY_ID }),
    ).resolves.toEqual({ status: 'preparing', reason: 'trigger_pending' })
  })
})
