import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { resolveAiRuntimeCapabilitySet } from '#/shared/ai-runtime-capability-contract'
import {
  createMerchantAiAuthorization,
  CURRENT_MERCHANT_AI_CAPABILITIES,
  type MerchantAiAuthorizationDeps,
  type MerchantAiAuthorizationStore,
  type MerchantAiCapability,
  type MerchantAiSnapshot,
} from './merchant-ai-authorization'

const NOW = new Date('2026-08-15T12:00:00.000Z')
const PROPERTY_ID = '00000000-0000-4000-8000-000000000001'
const LINEAGE_ID = '10000000-0000-4000-8000-000000000001'
const BASE_SNAPSHOT: MerchantAiSnapshot = {
  organizationId: 'org-1',
  propertyId: PROPERTY_ID,
  state: 'disabled',
  authorizationLineageId: null,
  capabilities: [],
  capabilityRuntimeProfileVersions: {},
  capabilityEpochs: {
    review_analysis: 0,
    reply_drafting: 0,
    property_trends: 0,
  },
  authorizedSourceEpoch: 0,
  analysisStartSequence: 0,
  stateVersion: 0,
  noticeVersion: MERCHANT_AI_NOTICE_VERSION,
  noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
  sourcePolicyId: 'google-business-profile-source-policy-v1',
  routingPolicyVersion: 1,
  processingRegion: 'global',
  providerDeploymentProfileVersion: 'private-beta-global-v1',
  redactionProfileFamily: 'gbp-review-global-v1',
}

function makeHarness(snapshot: MerchantAiSnapshot | null = null) {
  let current = snapshot
  const store: MerchantAiAuthorizationStore = {
    getSnapshot: vi.fn(async () => current),
    mutate: vi.fn(async (input) => {
      const next: MerchantAiSnapshot = {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        state: input.state,
        authorizationLineageId: current?.authorizationLineageId ?? LINEAGE_ID,
        capabilities: input.capabilities,
        capabilityRuntimeProfileVersions:
          input.capabilities.length === 0
            ? {}
            : resolveAiRuntimeCapabilitySet(input.capabilities),
        capabilityEpochs: {
          review_analysis: (current?.capabilityEpochs.review_analysis ?? 0) + 1,
          reply_drafting: (current?.capabilityEpochs.reply_drafting ?? 0) + 1,
          property_trends: (current?.capabilityEpochs.property_trends ?? 0) + 1,
        },
        authorizedSourceEpoch: current?.authorizedSourceEpoch || 1,
        analysisStartSequence: current?.analysisStartSequence ?? 0,
        stateVersion: (current?.stateVersion ?? 0) + 1,
        noticeVersion: input.noticeVersion,
        noticeDigest: input.noticeDigest,
        sourcePolicyId: input.sourcePolicyId,
        routingPolicyVersion: input.routingPolicyVersion,
        processingRegion: 'global',
        providerDeploymentProfileVersion: input.providerDeploymentProfileVersion,
        redactionProfileFamily: input.redactionProfileFamily,
      }
      current = next
      return next
    }),
    restoreReset: vi.fn(async () => BASE_SNAPSHOT),
  }
  const authorize = vi.fn<MerchantAiAuthorizationDeps['authorize']>(async () => true)
  const authorizeManagement = vi.fn<MerchantAiAuthorizationDeps['authorizeManagement']>(
    async () => true,
  )
  const verifyStepUp = vi.fn<MerchantAiAuthorizationDeps['verifyStepUp']>(
    async () => true,
  )
  const service = createMerchantAiAuthorization({
    store,
    authorize,
    authorizeManagement,
    verifyStepUp,
    clock: () => NOW,
    noticeVersion: BASE_SNAPSHOT.noticeVersion,
    noticeDigest: BASE_SNAPSHOT.noticeDigest,
    sourcePolicyId: BASE_SNAPSHOT.sourcePolicyId,
    routingPolicyVersion: BASE_SNAPSHOT.routingPolicyVersion,
    providerDeploymentProfileVersion: BASE_SNAPSHOT.providerDeploymentProfileVersion,
    redactionProfileFamily: BASE_SNAPSHOT.redactionProfileFamily,
  })
  return { service, store, authorize, authorizeManagement, verifyStepUp }
}

const baseCommand = {
  organizationId: BASE_SNAPSHOT.organizationId,
  propertyId: BASE_SNAPSHOT.propertyId,
  actorUserId: 'user-1',
  idempotencyKey: 'command-0001',
  expectedStateVersion: 0,
  stepUpProof: 'opaque-step-up-proof',
  reasonCode: 'merchant_enabled',
} as const

describe('Merchant AI authorization', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('defaults an absent authorization to disabled with the current notice', async () => {
    const { service } = makeHarness()

    await expect(
      service.get({
        organizationId: BASE_SNAPSHOT.organizationId,
        propertyId: BASE_SNAPSHOT.propertyId,
        actorUserId: 'user-1',
      }),
    ).resolves.toEqual(BASE_SNAPSHOT)
  })

  it('enables the fixed current capability bundle after management, policy, and step-up checks', async () => {
    const { service, store, authorize, verifyStepUp } = makeHarness()

    await expect(service.enable(baseCommand)).resolves.toMatchObject({
      state: 'enabled',
      capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
      stateVersion: 1,
    })
    expect(authorize).toHaveBeenCalledTimes(3)
    expect(verifyStepUp).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        organizationId: BASE_SNAPSHOT.organizationId,
        proof: 'opaque-step-up-proof',
        now: NOW,
      }),
    )
    expect(store.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'enable',
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
      }),
    )
  })

  it('fails before step-up or persistence when management is denied', async () => {
    const { service, authorizeManagement, authorize, verifyStepUp, store } = makeHarness()
    authorizeManagement.mockResolvedValue(false)

    await expect(service.enable(baseCommand)).rejects.toMatchObject({
      code: 'capability_denied',
    })
    expect(verifyStepUp).not.toHaveBeenCalled()
    expect(authorize).not.toHaveBeenCalled()
    expect(store.mutate).not.toHaveBeenCalled()
  })

  it('fails closed when a capability or fresh step-up is denied', async () => {
    const capabilityDenied = makeHarness()
    capabilityDenied.authorize.mockImplementation(
      async ({ capability }) => capability !== 'ai.generate_reply',
    )
    await expect(capabilityDenied.service.enable(baseCommand)).rejects.toMatchObject({
      code: 'capability_denied',
    })
    expect(capabilityDenied.store.mutate).not.toHaveBeenCalled()

    const stepUpDenied = makeHarness()
    stepUpDenied.verifyStepUp.mockResolvedValue(false)
    await expect(stepUpDenied.service.enable(baseCommand)).rejects.toMatchObject({
      code: 'step_up_required',
    })
    expect(stepUpDenied.store.mutate).not.toHaveBeenCalled()
  })

  it('rejects unknown, duplicate, empty, and dependency-invalid change sets', async () => {
    const { service, store } = makeHarness({
      ...BASE_SNAPSHOT,
      state: 'enabled',
      authorizationLineageId: LINEAGE_ID,
      capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
      capabilityRuntimeProfileVersions: resolveAiRuntimeCapabilitySet(
        CURRENT_MERCHANT_AI_CAPABILITIES,
      ),
      capabilityEpochs: {
        review_analysis: 1,
        reply_drafting: 1,
        property_trends: 1,
      },
      authorizedSourceEpoch: 1,
      analysisStartSequence: 0,
      stateVersion: 1,
    })
    const change = (capabilities: ReadonlyArray<MerchantAiCapability>) =>
      service.change({ ...baseCommand, expectedStateVersion: 1, capabilities })

    await expect(
      change(['review_analysis', 'unknown' as MerchantAiCapability]),
    ).rejects.toMatchObject({ code: 'unsupported_capability' })
    await expect(change(['review_analysis', 'review_analysis'])).rejects.toMatchObject({
      code: 'unsupported_capability',
    })
    await expect(change([])).rejects.toMatchObject({ code: 'capabilities_required' })
    await expect(change(['property_trends'])).rejects.toMatchObject({
      code: 'invalid_capability_dependency',
    })
    expect(store.mutate).not.toHaveBeenCalled()
  })

  it('normalizes a valid changed set into catalogue order', async () => {
    const { service } = makeHarness(BASE_SNAPSHOT)

    await expect(
      service.change({
        ...baseCommand,
        capabilities: ['property_trends', 'review_analysis'],
      }),
    ).resolves.toMatchObject({ capabilities: ['review_analysis', 'property_trends'] })
  })

  it('revokes to an empty capability set and still requires fresh step-up', async () => {
    const enabled: MerchantAiSnapshot = {
      ...BASE_SNAPSHOT,
      state: 'enabled',
      authorizationLineageId: LINEAGE_ID,
      capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
      capabilityRuntimeProfileVersions: resolveAiRuntimeCapabilitySet(
        CURRENT_MERCHANT_AI_CAPABILITIES,
      ),
      capabilityEpochs: {
        review_analysis: 4,
        reply_drafting: 4,
        property_trends: 4,
      },
      authorizedSourceEpoch: 3,
      analysisStartSequence: 0,
      stateVersion: 7,
    }
    const { service, verifyStepUp } = makeHarness(enabled)

    await expect(
      service.revoke({
        ...baseCommand,
        expectedStateVersion: 7,
        reasonCode: 'merchant_revoked',
      }),
    ).resolves.toMatchObject({
      state: 'revoked',
      capabilities: [],
      stateVersion: 8,
    })
    expect(verifyStepUp).toHaveBeenCalledTimes(1)
  })
})
