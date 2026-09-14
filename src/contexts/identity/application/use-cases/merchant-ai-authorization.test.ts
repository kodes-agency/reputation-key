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
import type { MerchantAiDecisionDeferral } from './merchant-ai-decision-deferral'

const NOW = new Date('2026-08-15T12:00:00.000Z')
const CURRENT_ACKNOWLEDGEMENT = Object.freeze({
  noticeVersion: MERCHANT_AI_NOTICE_VERSION,
  noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
})
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

function makeHarness(
  snapshot: MerchantAiSnapshot | null = null,
  standingDeferral: MerchantAiDecisionDeferral | null = null,
) {
  let current = snapshot
  let deferral = standingDeferral
  const decisionDeferrals = {
    findDecisionDeferral: vi.fn(async () => deferral),
  }
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
      // The store contract: an enable deletes the standing deferral atomically.
      if (input.state === 'enabled') deferral = null
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
  let ceremonySequence = 0
  const idGen = vi.fn(
    () => `c0000000-0000-4000-8000-${String(++ceremonySequence).padStart(12, '0')}`,
  )
  const service = createMerchantAiAuthorization({
    store,
    decisionDeferrals,
    authorize,
    authorizeManagement,
    verifyStepUp,
    clock: () => NOW,
    idGen,
    noticeVersion: BASE_SNAPSHOT.noticeVersion,
    noticeDigest: BASE_SNAPSHOT.noticeDigest,
    sourcePolicyId: BASE_SNAPSHOT.sourcePolicyId,
    routingPolicyVersion: BASE_SNAPSHOT.routingPolicyVersion,
    providerDeploymentProfileVersion: BASE_SNAPSHOT.providerDeploymentProfileVersion,
    redactionProfileFamily: BASE_SNAPSHOT.redactionProfileFamily,
  })
  return {
    service,
    store,
    decisionDeferrals,
    authorize,
    authorizeManagement,
    verifyStepUp,
    idGen,
  }
}

const baseCommand = {
  organizationId: BASE_SNAPSHOT.organizationId,
  propertyId: BASE_SNAPSHOT.propertyId,
  actorUserId: 'user-1',
  idempotencyKey: 'command-0001',
  expectedStateVersion: 0,
  acknowledgement: CURRENT_ACKNOWLEDGEMENT,
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
    ).resolves.toEqual({ ...BASE_SNAPSHOT, decisionDeferredAt: null })
  })

  it('surfaces a standing "not now" on a snapshot that is not enabled', async () => {
    const deferredAt = new Date('2026-08-14T09:30:00.000Z')
    const { service } = makeHarness(null, {
      organizationId: BASE_SNAPSHOT.organizationId,
      propertyId: BASE_SNAPSHOT.propertyId,
      deferredBy: 'user-1',
      deferredAt,
    })

    await expect(
      service.get({
        organizationId: BASE_SNAPSHOT.organizationId,
        propertyId: BASE_SNAPSHOT.propertyId,
        actorUserId: 'user-1',
      }),
    ).resolves.toMatchObject({
      state: 'disabled',
      decisionDeferredAt: deferredAt.toISOString(),
    })
  })

  it('never reads a deferral beside an enabled head, and an enable reports none', async () => {
    const { service, decisionDeferrals } = makeHarness(null, {
      organizationId: BASE_SNAPSHOT.organizationId,
      propertyId: BASE_SNAPSHOT.propertyId,
      deferredBy: 'user-1',
      deferredAt: new Date('2026-08-14T09:30:00.000Z'),
    })

    await expect(service.enable(baseCommand)).resolves.toMatchObject({
      state: 'enabled',
      decisionDeferredAt: null,
    })
    decisionDeferrals.findDecisionDeferral.mockClear()
    await expect(
      service.get({
        organizationId: BASE_SNAPSHOT.organizationId,
        propertyId: BASE_SNAPSHOT.propertyId,
        actorUserId: 'user-1',
      }),
    ).resolves.toMatchObject({ state: 'enabled', decisionDeferredAt: null })
    expect(decisionDeferrals.findDecisionDeferral).not.toHaveBeenCalled()
  })

  it('enables the fixed current capability bundle on an acknowledgement of the served notice', async () => {
    const { service, store, authorize, verifyStepUp } = makeHarness()

    await expect(service.enable(baseCommand)).resolves.toMatchObject({
      state: 'enabled',
      capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
      stateVersion: 1,
    })
    expect(authorize).toHaveBeenCalledTimes(3)
    // The step-up port is a reserved hook: consent never asks for a proof.
    expect(verifyStepUp).not.toHaveBeenCalled()
    expect(store.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'enable',
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
        ceremonyId: 'c0000000-0000-4000-8000-000000000001',
      }),
    )
  })

  it('refuses consent to any notice but the one served now', async () => {
    const staleAcknowledgements = [
      { ...CURRENT_ACKNOWLEDGEMENT, noticeVersion: 'merchant-ai-notice-2026-09-09.v1' },
      { ...CURRENT_ACKNOWLEDGEMENT, noticeDigest: '0'.repeat(64) },
    ]
    for (const acknowledgement of staleAcknowledgements) {
      const { service, store, authorize, authorizeManagement } =
        makeHarness(BASE_SNAPSHOT)
      await expect(
        service.enable({ ...baseCommand, acknowledgement }),
      ).rejects.toMatchObject({ code: 'notice_mismatch' })
      await expect(
        service.change({
          ...baseCommand,
          acknowledgement,
          capabilities: ['review_analysis'],
        }),
      ).rejects.toMatchObject({ code: 'notice_mismatch' })
      expect(authorizeManagement).not.toHaveBeenCalled()
      expect(authorize).not.toHaveBeenCalled()
      expect(store.mutate).not.toHaveBeenCalled()
    }
  })

  it('fails before policy checks or persistence when management is denied', async () => {
    const { service, authorizeManagement, authorize, store } = makeHarness()
    authorizeManagement.mockResolvedValue(false)

    await expect(service.enable(baseCommand)).rejects.toMatchObject({
      code: 'capability_denied',
    })
    expect(authorize).not.toHaveBeenCalled()
    expect(store.mutate).not.toHaveBeenCalled()
  })

  it('fails closed when a capability is denied', async () => {
    const { service, authorize, store } = makeHarness()
    authorize.mockImplementation(
      async ({ capability }) => capability !== 'ai.generate_reply',
    )

    await expect(service.enable(baseCommand)).rejects.toMatchObject({
      code: 'capability_denied',
    })
    expect(store.mutate).not.toHaveBeenCalled()
  })

  it('mints a fresh ceremony for every single-property command', async () => {
    const { service, store } = makeHarness()

    const enabled = await service.enable(baseCommand)
    await service.change({
      ...baseCommand,
      idempotencyKey: 'command-0002',
      expectedStateVersion: enabled.stateVersion,
      capabilities: ['review_analysis'],
    })

    const ceremonies = vi
      .mocked(store.mutate)
      .mock.calls.map(([input]) => input.ceremonyId)
    expect(ceremonies).toEqual([
      'c0000000-0000-4000-8000-000000000001',
      'c0000000-0000-4000-8000-000000000002',
    ])
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

  it('revokes to an empty capability set without an acknowledgement or step-up', async () => {
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
        organizationId: baseCommand.organizationId,
        propertyId: baseCommand.propertyId,
        actorUserId: baseCommand.actorUserId,
        idempotencyKey: baseCommand.idempotencyKey,
        expectedStateVersion: 7,
        reasonCode: 'merchant_revoked',
      }),
    ).resolves.toMatchObject({
      state: 'revoked',
      capabilities: [],
      stateVersion: 8,
    })
    expect(verifyStepUp).not.toHaveBeenCalled()
  })
})
