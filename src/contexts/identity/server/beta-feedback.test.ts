// What the PostgreSQL suite (beta-feedback.integration.test.ts) cannot reach:
// a permission set that disagrees with the role label, which real tenant
// resolution never produces, and a limiter or triage store that fails.

import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  enforceRateLimit: vi.fn(),
  captureFeedback: vi.fn(),
  pseudonym: vi.fn((_: string, audience: string) => `safe-${audience}`),
  prepareTriage: vi.fn(),
  listForActor: vi.fn(),
  markDelivered: vi.fn(),
  markFailed: vi.fn(),
  container: undefined as unknown,
}))

const FEEDBACK_REFERENCE = '00000000-0000-4000-8000-0000000000f1'
const NOW = new Date('2026-08-28T08:00:00.000Z')

vi.mock('#/composition', () => ({
  getContainer: () => mocks.container,
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
}))
vi.mock('../application/beta-feedback-pseudonym', () => ({
  betaFeedbackPseudonym: mocks.pseudonym,
}))

import { listMyBetaFeedbackHandler, submitBetaFeedbackHandler } from './beta-feedback'
import { submitBetaFeedback } from '../feedback/submit-beta-feedback.server'
import { listMyBetaFeedback } from '../feedback/list-my-beta-feedback.server'
import { deliverBetaFeedback } from '../feedback/beta-feedback-sentry-delivery.adapter.server'
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

// The Identity beta-feedback capability as the build wires it: the real use
// cases and Sentry seam (telemetry is mocked) over a mocked triage store.
const triageStore = {
  prepare: mocks.prepareTriage,
  listForActor: mocks.listForActor,
  markDelivered: mocks.markDelivered,
  markFailed: mocks.markFailed,
}
mocks.container = {
  rateLimiter: { check: vi.fn() },
  identityRequestSecurity: {
    betaFeedbackHmacSecret: 'feedback-secret',
  },
  identityBetaFeedback: {
    submit: submitBetaFeedback({
      store: triageStore,
      deliver: deliverBetaFeedback,
      findReporterContact: async () => ({ name: 'Ana Admin', email: 'ana@example.com' }),
      clock: () => NOW,
      idGen: () => FEEDBACK_REFERENCE,
      hmacSecret: 'feedback-secret',
    }),
    listMine: listMyBetaFeedback({ store: triageStore, hmacSecret: 'feedback-secret' }),
  },
}

const actor = {
  organizationId: 'private-organization-id',
  userId: 'private-user-id',
  role: 'PropertyManager',
} as const

const bug = {
  kind: 'bug',
  impact: 'cannot_complete',
  clientErrorEventId: null,
  maskedLayout: null,
  screenshot: null,
  message: 'The reviews page did not load.',
  routePath: '/properties/private-property-id/reviews',
  viewport: 'wide',
} as const

// `feedback.beta_report` answers to no switch, so reporting does not depend on
// the feature the reporter is stuck on.
function feedbackPolicyStore(
  overrides: Partial<CapabilityPolicyStore> = {},
): CapabilityPolicyStore {
  return {
    isCapabilityKilled: () => false,
    isOrgSuspended: () => false,
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

  it('uses current feedback permission rather than a stale Member role label', async () => {
    mocks.resolveTenantContext.mockResolvedValue({
      ...actor,
      role: 'Member',
      effectivePermissions: new Set(['feedback.beta_report']),
      scopeByPermission: new Map([['feedback.beta_report', 'assigned-properties']]),
    })

    await expect(
      withStartContext(() => submitBetaFeedbackHandler({ data: bug })),
    ).resolves.toEqual({ reference: FEEDBACK_REFERENCE })
    expect(mocks.enforceRateLimit).toHaveBeenCalledTimes(1)
    expect(mocks.captureFeedback).toHaveBeenCalledTimes(1)
  })

  it('does not capture when the abuse budget denies the submission', async () => {
    mocks.enforceRateLimit.mockRejectedValue(new Error('limited'))

    await expect(
      withStartContext(() => submitBetaFeedbackHandler({ data: bug })),
    ).rejects.toMatchObject({ name: 'InternalError', status: 500 })
    expect(mocks.captureFeedback).not.toHaveBeenCalled()
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

describe('list my beta feedback server function', () => {
  const report = {
    reference: FEEDBACK_REFERENCE,
    feedbackType: 'bug',
    impactCode: 'cannot_complete',
    routeKey: 'properties.property.reviews',
    deliveryState: 'delivered',
    triageState: 'accepted',
    engineeringIssueRef: '472',
    createdAt: NOW,
    updatedAt: NOW,
  } as const

  beforeEach(() => {
    vi.clearAllMocks()
    initPermissionTable()
    initCapabilityPolicyStore(feedbackPolicyStore())
    initExecutionPolicy(
      createExecutionPolicy({ listAccessiblePropertyIds: async () => [] }),
    )
    mocks.resolveTenantContext.mockResolvedValue(actor)
    mocks.listForActor.mockResolvedValue([report])
  })

  afterEach(() => {
    resetExecutionPolicy()
    resetCapabilityPolicyStore()
  })

  it('denies a reporter whose feedback permission is absent', async () => {
    mocks.resolveTenantContext.mockResolvedValue({
      ...actor,
      role: 'PropertyManager',
      effectivePermissions: new Set<string>(),
      scopeByPermission: new Map<string, string>(),
    })

    await expect(
      withStartContext(() => listMyBetaFeedbackHandler()),
    ).rejects.toMatchObject({ name: 'AuthError', status: 403 })
    expect(mocks.listForActor).not.toHaveBeenCalled()
  })
})
