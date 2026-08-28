import { AsyncLocalStorage } from 'node:async_hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  enforceRateLimit: vi.fn(),
  captureFeedback: vi.fn(),
  pseudonym: vi.fn((_: string, audience: string) => `safe-${audience}`),
  prepareTriage: vi.fn(),
  markDelivered: vi.fn(),
  markFailed: vi.fn(),
}))

const FEEDBACK_REFERENCE = '00000000-0000-4000-8000-0000000000f1'
const NOW = new Date('2026-08-28T08:00:00.000Z')

vi.mock('#/composition', () => ({
  getContainer: () => ({
    rateLimiter: { check: vi.fn() },
    identityRequestSecurity: {
      betaFeedbackHmacSecret: 'feedback-secret',
    },
    db: {},
    idGen: () => FEEDBACK_REFERENCE,
    clock: () => NOW,
    betaFeedbackTriageRepo: {
      prepare: mocks.prepareTriage,
      markDelivered: mocks.markDelivered,
      markFailed: mocks.markFailed,
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers({ cookie: 'session=current' })),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/observability/telemetry', () => ({
  captureObservabilityFeedback: mocks.captureFeedback,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))
vi.mock('./beta-feedback-rate-limit.server', () => ({
  enforceBetaFeedbackRateLimit: mocks.enforceRateLimit,
  betaFeedbackPseudonym: mocks.pseudonym,
}))

import { submitBetaFeedbackHandler } from './beta-feedback'
import {
  createExecutionPolicy,
  initExecutionPolicy,
  resetExecutionPolicy,
} from '#/shared/auth/execution-policy'
import {
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
  type CapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { initPermissionTable } from '#/shared/auth/permissions'
import type { MaskedLayoutSnapshot } from '#/shared/beta-feedback-contract'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

const actor = {
  organizationId: 'private-organization-id',
  userId: 'private-user-id',
  role: 'PropertyManager',
} as const

const bug = {
  type: 'bug',
  title: 'Reviews page did not load',
  expected: 'The reviews list should appear.',
  actual: 'The loading state remained on screen.',
  steps: 'Open a property and select Reviews.',
  impact: 'workaround_available',
  routePath: '/properties/private-property-id/reviews',
  viewport: 'wide',
} as const

function feedbackPolicyStore(
  overrides: Partial<CapabilityPolicyStore> = {},
): CapabilityPolicyStore {
  return {
    isCapabilityGloballyEnabled: () => false,
    isOrgAllowlisted: (candidateOrganizationId, capability) =>
      candidateOrganizationId === actor.organizationId &&
      capability === 'portal.guest_response',
    isPropertyAllowlisted: () => false,
    isOrgSuspended: () => false,
    isPropertySuspended: () => false,
    ...overrides,
  }
}

describe('submit beta feedback server function', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    initPermissionTable()
    initCapabilityPolicyStore(feedbackPolicyStore())
    initExecutionPolicy(
      createExecutionPolicy({ listAccessiblePropertyIds: async () => [] }),
    )
    mocks.resolveTenantContext.mockResolvedValue(actor)
    mocks.enforceRateLimit.mockResolvedValue(undefined)
    mocks.captureFeedback.mockReturnValue('a'.repeat(32))
    mocks.prepareTriage.mockResolvedValue({ revision: 0 })
    mocks.markDelivered.mockResolvedValue({ revision: 1 })
    mocks.markFailed.mockResolvedValue({ revision: 1 })
  })

  afterEach(() => {
    resetExecutionPolicy()
    resetCapabilityPolicyStore()
  })

  it('submits allowlisted manager feedback and returns an opaque receipt', async () => {
    const result = await withStartContext(() => submitBetaFeedbackHandler({ data: bug }))

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: actor.userId,
        organizationId: actor.organizationId,
        keyHmacSecret: 'feedback-secret',
      }),
    )
    expect(mocks.prepareTriage).toHaveBeenCalledWith({
      reference: FEEDBACK_REFERENCE,
      organizationPseudonym: 'safe-telemetry-organization',
      actorPseudonym: 'safe-telemetry-actor',
      feedbackType: 'bug',
      impactCode: 'workaround_available',
      routeKey: 'properties.property.reviews',
      viewport: 'wide',
      reporterRole: 'PropertyManager',
      attachmentKind: 'none',
      attachmentCapturedAt: null,
      attachmentExpiresAt: null,
      now: NOW,
    })
    expect(mocks.captureFeedback).toHaveBeenCalledWith({
      message: expect.stringContaining('Title: Reviews page did not load'),
      source: 'repkey-native-beta-feedback',
      tags: {
        feedback_type: 'bug',
        feedback_impact: 'workaround_available',
        feedback_route: 'properties.property.reviews',
        feedback_actor: 'safe-telemetry-actor',
        feedback_organization: 'safe-telemetry-organization',
        feedback_viewport: 'wide',
        feedback_role: 'PropertyManager',
        feedback_reference: FEEDBACK_REFERENCE,
        feedback_attachment: 'none',
        feedback_attachment_retention: 'not_applicable',
        feedback_triage_state: 'new',
        feedback_triage_owner: 'beta_support',
        feedback_triage_severity: 'unclassified',
        feedback_triage_privacy: 'pending',
        feedback_triage_security: 'pending',
        feedback_triage_reproduction: 'pending',
        feedback_triage_dedupe: 'pending',
        feedback_customer_response: 'pending',
      },
    })
    expect(JSON.stringify(mocks.captureFeedback.mock.calls)).not.toContain(
      'private-property-id',
    )
    expect(JSON.stringify(mocks.captureFeedback.mock.calls)).not.toContain(actor.userId)
    expect(JSON.stringify(mocks.captureFeedback.mock.calls)).not.toContain(
      actor.organizationId,
    )
    expect(mocks.markDelivered).toHaveBeenCalledWith({
      reference: FEEDBACK_REFERENCE,
      providerReference: 'a'.repeat(32),
      expectedRevision: 0,
      now: NOW,
    })
    expect(result).toEqual({ reference: FEEDBACK_REFERENCE })
  })

  it('prepares and delivers a consented masked Bug layout with an exact 30-day expiry', async () => {
    const attachment: MaskedLayoutSnapshot = {
      profile: 'masked-layout-v1',
      consented: true,
      gridWidth: 64,
      gridHeight: 40,
      blocks: [{ kind: 'input', x: 4, y: 5, width: 20, height: 2 }],
    }

    await expect(
      withStartContext(() =>
        submitBetaFeedbackHandler({
          data: { ...bug, routePath: '/dashboard', attachment },
        }),
      ),
    ).resolves.toEqual({ reference: FEEDBACK_REFERENCE })

    expect(mocks.prepareTriage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentKind: 'masked_layout_v1',
        attachmentCapturedAt: NOW,
        attachmentExpiresAt: new Date('2026-09-27T08:00:00.000Z'),
      }),
    )
    expect(mocks.captureFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: expect.objectContaining({
          feedback_attachment: 'masked_layout_v1',
          feedback_attachment_retention: '30d_max',
        }),
        maskedLayoutAttachment: {
          capturedAt: NOW.toISOString(),
          expiresAt: '2026-09-27T08:00:00.000Z',
          snapshot: attachment,
        },
      }),
    )
    expect(JSON.stringify(mocks.captureFeedback.mock.calls)).not.toContain('data:image')
  })

  it('rejects Staff before consuming a feedback budget', async () => {
    mocks.resolveTenantContext.mockResolvedValue({ ...actor, role: 'Staff' })

    await expect(
      withStartContext(() => submitBetaFeedbackHandler({ data: bug })),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'permission_denied',
      status: 403,
    })
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.captureFeedback).not.toHaveBeenCalled()
  })

  it('denies when current feedback permission is absent despite a PropertyManager label', async () => {
    mocks.resolveTenantContext.mockResolvedValue({
      ...actor,
      effectivePermissions: new Set(),
      scopeByPermission: new Map(),
    })

    await expect(
      withStartContext(() => submitBetaFeedbackHandler({ data: bug })),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'permission_denied',
      status: 403,
    })
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.captureFeedback).not.toHaveBeenCalled()
  })

  it('uses current feedback permission rather than a stale Staff label', async () => {
    mocks.resolveTenantContext.mockResolvedValue({
      ...actor,
      role: 'Staff',
      effectivePermissions: new Set(['feedback.respond']),
      scopeByPermission: new Map([['feedback.respond', 'assigned-properties']]),
    })

    await expect(
      withStartContext(() => submitBetaFeedbackHandler({ data: bug })),
    ).resolves.toEqual({ reference: FEEDBACK_REFERENCE })
    expect(mocks.enforceRateLimit).toHaveBeenCalledTimes(1)
    expect(mocks.captureFeedback).toHaveBeenCalledTimes(1)
  })

  it('denies an organization outside the feedback capability cohort', async () => {
    initCapabilityPolicyStore(
      feedbackPolicyStore({
        isOrgAllowlisted: () => false,
      }),
    )

    await expect(
      withStartContext(() => submitBetaFeedbackHandler({ data: bug })),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'org_not_allowlisted',
      status: 403,
    })
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.captureFeedback).not.toHaveBeenCalled()
  })

  it('does not capture when the abuse budget denies the submission', async () => {
    mocks.enforceRateLimit.mockRejectedValue(new Error('limited'))

    await expect(
      withStartContext(() => submitBetaFeedbackHandler({ data: bug })),
    ).rejects.toMatchObject({ name: 'InternalError', status: 500 })
    expect(mocks.captureFeedback).not.toHaveBeenCalled()
  })

  it('returns a stable unavailable response when delivery is not initialized', async () => {
    mocks.captureFeedback.mockReturnValue(undefined)

    await expect(
      withStartContext(() => submitBetaFeedbackHandler({ data: bug })),
    ).rejects.toMatchObject({
      name: 'FeedbackError',
      code: 'temporarily_unavailable',
      status: 503,
    })
    expect(mocks.markFailed).toHaveBeenCalledWith({
      reference: FEEDBACK_REFERENCE,
      failureCode: 'monitoring_unavailable',
      expectedRevision: 0,
      now: NOW,
    })
  })

  it('keeps a malformed provider receipt out of durable delivered state', async () => {
    mocks.captureFeedback.mockReturnValue('not-a-provider-event-id')

    await expect(
      withStartContext(() => submitBetaFeedbackHandler({ data: bug })),
    ).rejects.toMatchObject({
      name: 'FeedbackError',
      code: 'temporarily_unavailable',
      status: 503,
    })
    expect(mocks.markFailed).toHaveBeenCalledWith({
      reference: FEEDBACK_REFERENCE,
      failureCode: 'monitoring_invalid_reference',
      expectedRevision: 0,
      now: NOW,
    })
    expect(mocks.markDelivered).not.toHaveBeenCalled()
  })

  it('does not deliver when the durable triage receipt cannot be prepared', async () => {
    mocks.prepareTriage.mockRejectedValue(new Error('database unavailable'))

    await expect(
      withStartContext(() => submitBetaFeedbackHandler({ data: bug })),
    ).rejects.toMatchObject({ name: 'InternalError', status: 500 })
    expect(mocks.captureFeedback).not.toHaveBeenCalled()
    expect(mocks.markDelivered).not.toHaveBeenCalled()
  })
})
