import { describe, expect, it, vi } from 'vitest'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { resolveAiRuntimeCapabilitySet } from '#/shared/ai-runtime-capability-contract'
import {
  createMerchantAiAuthorization,
  type MerchantAiAuthorizationStore,
  type MerchantAiSnapshot,
} from './merchant-ai-authorization'
import {
  createMerchantAiDecisionDeferral,
  type MerchantAiDecisionDeferral,
  type MerchantAiDecisionDeferralStore,
} from './merchant-ai-decision-deferral'

const ORGANIZATION_ID = 'org-deferral'
const PROPERTY_ID = '00000000-0000-4000-8000-0000000000d1'
const FIRST_DEFERRAL = new Date('2026-09-15T08:00:00.000Z')
const input = {
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  actorUserId: 'admin-1',
} as const

/**
 * One in-memory Property honouring both store contracts: a deferral is refused
 * while the head is enabled and a repeat keeps the standing row; an enable
 * deletes the deferral as part of its mutation.
 */
function makeWorld() {
  let now = FIRST_DEFERRAL
  let head: MerchantAiSnapshot | null = null
  let authorityAllowed = true
  let propertyExists = true
  const deferrals = new Map<string, MerchantAiDecisionDeferral>()

  const deferralStore: MerchantAiDecisionDeferralStore = {
    findDecisionDeferral: vi.fn(
      async ({ propertyId }) => deferrals.get(propertyId) ?? null,
    ),
    deferDecision: vi.fn(async (command) => {
      if (!propertyExists) return { outcome: 'property_not_found' } as const
      if (!authorityAllowed) return { outcome: 'authority_denied' } as const
      if (head?.state === 'enabled') return { outcome: 'already_enabled' } as const
      const standing = deferrals.get(command.propertyId)
      if (standing) return { outcome: 'deferred', deferral: standing } as const
      const deferral = {
        organizationId: command.organizationId,
        propertyId: command.propertyId,
        deferredBy: command.actorUserId,
        deferredAt: command.now,
      }
      deferrals.set(command.propertyId, deferral)
      return { outcome: 'deferred', deferral } as const
    }),
  }
  const authorizationStore: MerchantAiAuthorizationStore = {
    getSnapshot: vi.fn(async () => head),
    mutate: vi.fn(async (mutation) => {
      head = {
        organizationId: mutation.organizationId,
        propertyId: mutation.propertyId,
        state: mutation.state,
        authorizationLineageId: '10000000-0000-4000-8000-0000000000d1',
        capabilities: mutation.capabilities,
        capabilityRuntimeProfileVersions:
          mutation.capabilities.length === 0
            ? {}
            : resolveAiRuntimeCapabilitySet(mutation.capabilities),
        capabilityEpochs: { review_analysis: 1, reply_drafting: 1, property_trends: 1 },
        authorizedSourceEpoch: 0,
        analysisStartSequence: 0,
        stateVersion: (head?.stateVersion ?? 0) + 1,
        noticeVersion: mutation.noticeVersion,
        noticeDigest: mutation.noticeDigest,
        sourcePolicyId: mutation.sourcePolicyId,
        routingPolicyVersion: mutation.routingPolicyVersion,
        processingRegion: 'global',
        providerDeploymentProfileVersion: mutation.providerDeploymentProfileVersion,
        redactionProfileFamily: mutation.redactionProfileFamily,
      }
      if (mutation.state === 'enabled') deferrals.delete(mutation.propertyId)
      return head
    }),
    restoreReset: vi.fn(async () => {
      throw new Error('restore reset is not exercised here')
    }),
  }
  const authorizeManagement = vi.fn(async () => true)
  const clock = () => now

  const deferral = createMerchantAiDecisionDeferral({
    store: deferralStore,
    authorizeManagement,
    clock,
  })
  const authorization = createMerchantAiAuthorization({
    store: authorizationStore,
    decisionDeferrals: deferralStore,
    authorizeManagement,
    authorize: async () => true,
    verifyStepUp: async () => true,
    clock,
    idGen: () => 'c0000000-0000-4000-8000-0000000000d1',
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    sourcePolicyId: 'google-business-profile-source-policy-v1',
    routingPolicyVersion: 1,
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    redactionProfileFamily: 'gbp-review-global-v1',
  })

  return {
    deferral,
    authorization,
    deferralStore,
    authorizeManagement,
    advanceClock: (to: Date) => {
      now = to
    },
    enableDirectly: () =>
      authorization.enable({
        ...input,
        idempotencyKey: 'enable-command-0001',
        expectedStateVersion: head?.stateVersion ?? 0,
        acknowledgement: {
          noticeVersion: MERCHANT_AI_NOTICE_VERSION,
          noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        },
        reasonCode: 'merchant_enabled',
      }),
    loseAuthority: () => {
      authorityAllowed = false
    },
    removeProperty: () => {
      propertyExists = false
    },
  }
}

describe('Merchant AI decision deferral', () => {
  it('records "not now" once and returns the original instant on a repeat', async () => {
    const world = makeWorld()

    await expect(world.deferral.defer(input)).resolves.toEqual({
      propertyId: PROPERTY_ID,
      decisionDeferredAt: FIRST_DEFERRAL.toISOString(),
    })
    world.advanceClock(new Date('2026-09-16T08:00:00.000Z'))
    await expect(world.deferral.defer(input)).resolves.toEqual({
      propertyId: PROPERTY_ID,
      decisionDeferredAt: FIRST_DEFERRAL.toISOString(),
    })

    expect(world.deferralStore.deferDecision).toHaveBeenCalledTimes(2)
    await expect(world.authorization.get(input)).resolves.toMatchObject({
      state: 'disabled',
      decisionDeferredAt: FIRST_DEFERRAL.toISOString(),
    })
  })

  it('refuses with a tagged already_enabled error while AI is enabled', async () => {
    const world = makeWorld()
    await world.enableDirectly()

    const refusal = world.deferral.defer(input)

    await expect(refusal).rejects.toMatchObject({
      _tag: 'MerchantAiDecisionError',
      code: 'already_enabled',
    })
    await expect(refusal).rejects.toBeInstanceOf(Error)
    await expect(world.authorization.get(input)).resolves.toMatchObject({
      state: 'enabled',
      decisionDeferredAt: null,
    })
  })

  it('clears the standing deferral when AI is enabled', async () => {
    const world = makeWorld()
    await world.deferral.defer(input)

    await expect(world.enableDirectly()).resolves.toMatchObject({
      state: 'enabled',
      decisionDeferredAt: null,
    })

    await expect(world.authorization.get(input)).resolves.toMatchObject({
      state: 'enabled',
      decisionDeferredAt: null,
    })
    await expect(
      world.deferralStore.findDecisionDeferral({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
      }),
    ).resolves.toBeNull()
  })

  it('fails before the store when AI management is denied', async () => {
    const world = makeWorld()
    world.authorizeManagement.mockResolvedValue(false)

    await expect(world.deferral.defer(input)).rejects.toMatchObject({
      name: 'MerchantAiAuthorizationError',
      code: 'capability_denied',
    })
    expect(world.deferralStore.deferDecision).not.toHaveBeenCalled()
  })

  it('denies when the transactional authority recheck fails', async () => {
    const world = makeWorld()
    world.loseAuthority()

    await expect(world.deferral.defer(input)).rejects.toMatchObject({
      name: 'MerchantAiAuthorizationError',
      code: 'capability_denied',
    })
  })

  it('refuses a Property outside the Organization', async () => {
    const world = makeWorld()
    world.removeProperty()

    await expect(world.deferral.defer(input)).rejects.toMatchObject({
      _tag: 'MerchantAiDecisionError',
      code: 'property_not_found',
    })
  })

  it('rejects a command without an organization, property, or actor', async () => {
    const world = makeWorld()

    for (const missing of ['organizationId', 'propertyId', 'actorUserId'] as const) {
      await expect(
        world.deferral.defer({ ...input, [missing]: '' }),
      ).rejects.toMatchObject({ code: 'invalid_command' })
    }
    expect(world.authorizeManagement).not.toHaveBeenCalled()
    expect(world.deferralStore.deferDecision).not.toHaveBeenCalled()
  })
})
