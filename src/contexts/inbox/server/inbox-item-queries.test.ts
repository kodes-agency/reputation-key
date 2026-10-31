import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  actor: vi.fn(),
  gate: vi.fn(),
  decide: vi.fn(),
  frame: vi.fn(),
  consent: vi.fn(),
}))
const NOW = new Date('2026-11-01T12:00:00Z')
vi.mock('#/composition', () => ({
  getContainer: () => ({
    inboxPublicApi: { getInboxItemDetail: mocks.detail },
    reviewPublicApi: { aiReplyVoice: { resolveSavedFrame: mocks.frame } },
    clock: () => NOW,
    aiPublicApi: { readReplyDraftingConsent: mocks.consent },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: async () => new Headers(),
}))
vi.mock('#/shared/auth/middleware', () => ({ resolveTenantContext: mocks.actor }))
vi.mock('#/shared/auth/execution-policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/shared/auth/execution-policy')>()),
  requireExecutionAllowed: mocks.gate,
  getExecutionPolicy: () => ({ decide: mocks.decide }),
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))
vi.mock('./inbox-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./inbox-shared')>()),
  createServerFn: () => ({
    validator: () => ({ handler: (handler: (input: unknown) => unknown) => handler }),
  }),
}))
import { createReadReplyDraftingConsent } from '#/contexts/ai/application/read-reply-drafting-consent'
import { createExecutionPolicy } from '#/shared/auth/execution-policy'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { getAiRuntimeCapability } from '#/shared/ai-runtime-capability-contract'
import {
  organizationId as orgId,
  propertyId as propId,
  userId,
} from '#/shared/domain/ids'
import { getInboxItemDetailFn } from './inbox-item-queries'
const itemId = '750e8400-e29b-41d4-a716-446655440011'
const propertyId = '750e8400-e29b-41d4-a716-446655440012'
const actor = {
  organizationId: orgId('org'),
  userId: userId('manager'),
  role: 'AccountAdmin',
} as const
const expectedFence = {
  authorizationLineageId: '750e8400-e29b-41d4-a716-446655440013',
  capabilityEpoch: 2,
  authorizedSourceEpoch: 1,
  stateVersion: 3,
  noticeDigest: 'a'.repeat(64),
  recordedRuntimeProfileVersion: 'reply-drafting-runtime-v1',
  servedExecution: getAiRuntimeCapability('reply_drafting'),
}
beforeEach(() => {
  vi.clearAllMocks()
  resetCapabilityPolicyStore()
  initCapabilityPolicyStore(
    createEnvCapabilityPolicyStore({ BETA_ALLOWLIST_ORGS: 'org' }),
  )
  mocks.consent.mockResolvedValue({
    subjectType: 'property',
    subjectId: propertyId,
    purpose: 'ai.generate_reply',
    expectedFence,
  })
  mocks.actor.mockResolvedValue(actor)
  mocks.gate.mockResolvedValue(undefined)
  mocks.detail.mockResolvedValue({ item: { id: itemId, propertyId }, reply: null })
  mocks.decide.mockResolvedValue({ allowed: true })
})
describe('detail background drafting availability', () => {
  it('reads access first, then asks current user/property consent at the application clock', async () => {
    const result = await withStartContext(() =>
      getInboxItemDetailFn({ data: { inboxItemId: itemId } }),
    )
    expect(result.replyDraftingAvailable).toBe(true)
    expect(mocks.decide).toHaveBeenCalledWith({
      principal: { kind: 'user', ctx: actor },
      action: 'ai.reply.generate',
      organizationId: 'org',
      propertyId,
      executionKind: 'interactive',
      consent: {
        subjectType: 'property',
        subjectId: propertyId,
        purpose: 'ai.generate_reply',
        expectedFence,
      },
      now: NOW,
    })
    expect(mocks.frame).not.toHaveBeenCalled()
  })
  it('admits background drafting through the real policy with the current authorization fence', async () => {
    const authorization = {
      readMerchantAuthorization: vi.fn(async () => ({
        organizationId: actor.organizationId,
        propertyId: propId(propertyId),
        state: 'enabled' as const,
        stateVersion: expectedFence.stateVersion,
        authorizationLineageId: expectedFence.authorizationLineageId,
        authorizedSourceEpoch: expectedFence.authorizedSourceEpoch,
        capabilities: ['reply_drafting'] as const,
        capabilityRuntimeProfileVersions: {
          reply_drafting: expectedFence.recordedRuntimeProfileVersion,
        },
        capabilityEpochs: {
          review_analysis: { epoch: 1, changedAtEpochMillis: null },
          reply_drafting: { epoch: 2, changedAtEpochMillis: null },
          property_trends: { epoch: 1, changedAtEpochMillis: null },
        },
        reviewAnalysisStartSequence: 0,
        noticeVersion: 'notice',
        noticeDigest: expectedFence.noticeDigest,
        sourcePolicyId: 'policy',
        sourceCanonicalizerDigest: 'b'.repeat(64),
        redactionProfileFamily: 'redaction',
        providerDeploymentProfileVersion: 'private-beta-global-v2',
      })),
    }
    mocks.consent.mockImplementation(
      createReadReplyDraftingConsent(authorization, async () => []),
    )
    const hasActiveConsent = vi.fn(async () => true)
    mocks.decide.mockImplementation(
      createExecutionPolicy({
        listAccessiblePropertyIds: async () => [],
        hasActiveConsent,
      }).decide,
    )
    const result = await withStartContext(() =>
      getInboxItemDetailFn({ data: { inboxItemId: itemId } }),
    )
    expect(result.replyDraftingAvailable).toBe(true)
    expect(hasActiveConsent).toHaveBeenCalledWith({
      organizationId: 'org',
      subjectType: 'property',
      subjectId: propertyId,
      purpose: 'ai.generate_reply',
      expectedFence,
      at: NOW,
    })
    hasActiveConsent.mockResolvedValue(false)
    expect(
      (
        await withStartContext(() =>
          getInboxItemDetailFn({ data: { inboxItemId: itemId } }),
        )
      ).replyDraftingAvailable,
    ).toBe(false)
  })
  it('reads persisted frame lengths without consulting or rotating the current voice', async () => {
    const prefix = 'Hello Anna,'
    const suffix = 'Kind regards, Our team'
    mocks.detail.mockResolvedValue({
      item: { id: itemId, propertyId },
      reply: {
        aiGenerated: true,
        text: `${prefix}\n\nA short body.\n\n${suffix}`,
        voiceDigest: 'a'.repeat(64),
        voiceChoices: {
          closing: 0,
          signOff: 0,
          contactSentence: 0,
          emoji: 0,
          includeContact: true,
          bodyPrefixLength: prefix.length,
          bodySuffixLength: suffix.length,
        },
      },
    })
    const result = await withStartContext(() =>
      getInboxItemDetailFn({ data: { inboxItemId: itemId } }),
    )
    expect(result.replyBodyFrame).toEqual({ prefix, suffix })
    expect(mocks.frame).not.toHaveBeenCalled()
  })
  it('does not turn a disabled property into a background drafting candidate', async () => {
    mocks.decide.mockResolvedValue({ allowed: false })
    const result = await withStartContext(() =>
      getInboxItemDetailFn({ data: { inboxItemId: itemId } }),
    )
    expect(result.replyDraftingAvailable).toBe(false)
  })
  it('exposes nothing after an access refusal', async () => {
    mocks.gate.mockRejectedValue(new Error('denied'))
    await expect(
      withStartContext(() => getInboxItemDetailFn({ data: { inboxItemId: itemId } })),
    ).rejects.toThrow('denied')
    expect(mocks.detail).not.toHaveBeenCalled()
    expect(mocks.decide).not.toHaveBeenCalled()
  })
})
