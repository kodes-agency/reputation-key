import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'

const NOW = new Date('2026-09-02T10:00:00.000Z')
const PROPERTY_ID = '00000000-0000-4000-8000-000000000408'

const actor = {
  organizationId: 'org-policy-admin',
  userId: 'operator-policy-admin',
  role: 'AccountAdmin',
} as unknown as AuthContext

const mocks = vi.hoisted(() => ({
  headersFromContext: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  explainPolicyDecision: vi.fn(),
  explainCapabilityRefusal: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validator:
      | Readonly<{
          '~standard': Readonly<{
            validate: (
              input: unknown,
            ) =>
              | Promise<{ value?: unknown; issues?: ReadonlyArray<unknown> }>
              | { value?: unknown; issues?: ReadonlyArray<unknown> }
          }>
        }>
      | undefined
    const builder = {
      validator(next: typeof validator) {
        validator = next
        return builder
      },
      handler(fn: (context: { data: unknown }) => Promise<unknown>) {
        return async (options: { data?: unknown } = {}) => {
          if (!validator) return fn({ data: options.data })
          const parsed = await validator['~standard'].validate(options.data)
          if (parsed.issues) throw new Error(JSON.stringify(parsed.issues))
          return fn({ data: parsed.value })
        }
      },
    }
    return builder
  },
}))

vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: mocks.headersFromContext,
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    clock: () => NOW,
    policyAdmin: {
      explainPolicyDecision: mocks.explainPolicyDecision,
      explainCapabilityRefusal: mocks.explainCapabilityRefusal,
    },
  }),
}))

import { explainPolicyDecisionFn } from './policy-admin'

const explanation = {
  allowed: true,
  reason: 'allowed',
  action: 'property.read_gbp_performance',
  capability: 'property.read_gbp_performance',
  checks: {
    capability: { allowed: true, reason: 'allowed' },
    permission: { allowed: true },
    scope: { outcome: 'granted' },
  },
} as const

const capabilityRefusal = {
  capability: 'property.read_gbp_performance',
  allowed: false,
  decidedBy: 'google_execution_control',
  code: 'no_execution_control_row',
  fate: null,
  chain: [],
  permitOutcomes: [],
} as const

describe('explainPolicyDecisionFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.headersFromContext.mockResolvedValue(new Headers())
    mocks.resolveTenantContext.mockResolvedValue(actor)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.explainPolicyDecision.mockResolvedValue(explanation)
    mocks.explainCapabilityRefusal.mockResolvedValue(capabilityRefusal)
  })

  it('adds the cross-authority refusal report without reshaping the policy explanation', async () => {
    const response = await explainPolicyDecisionFn({
      data: {
        action: 'property.read_gbp_performance',
        propertyId: PROPERTY_ID,
        userId: 'member-under-diagnosis',
      },
    })

    expect(response).toEqual({ ...explanation, capabilityRefusal })
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor,
      action: 'policy.admin',
      propertyId: PROPERTY_ID,
    })
    expect(mocks.explainPolicyDecision).toHaveBeenCalledWith({
      organizationId: 'org-policy-admin',
      action: 'property.read_gbp_performance',
      propertyId: PROPERTY_ID,
      userId: 'member-under-diagnosis',
      now: NOW,
    })
    expect(mocks.explainCapabilityRefusal).toHaveBeenCalledWith({
      capability: 'property.read_gbp_performance',
      organizationId: 'org-policy-admin',
      propertyId: PROPERTY_ID,
      role: 'AccountAdmin',
      userId: 'member-under-diagnosis',
      permissionScope: { allowed: true, scopeOutcome: 'granted' },
    })
  })
})
