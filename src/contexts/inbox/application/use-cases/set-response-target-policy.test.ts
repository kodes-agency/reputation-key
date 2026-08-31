import { describe, expect, it, vi } from 'vitest'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { ResponseTargetPolicyStore } from '../ports/response-target-policy.store'
import { setResponseTargetPolicy } from './set-response-target-policy'

const ORG = organizationId('org-target-policy')
const USER = userId('user-target-policy')
const PROPERTY = propertyId('7a000000-0000-4000-8000-000000000001')
const NOW = new Date('2026-08-28T12:00:00.000Z')

const policyStore = (): ResponseTargetPolicyStore => ({
  getPolicySettings: vi.fn(async () => ({
    organization: {
      googleReviewResponse: {
        targetKind: 'google_review_response' as const,
        durationMinutes: 2_880,
        policySource: 'builtin_default' as const,
        policyVersion: null,
      },
      privateFeedbackHandling: {
        targetKind: 'private_feedback_handling' as const,
        durationMinutes: 2_880,
        policySource: 'builtin_default' as const,
        policyVersion: null,
      },
    },
    privateFeedbackPropertyOverride: null,
  })),
  setOrganizationPolicy: vi.fn(async () => ({
    scope: 'organization' as const,
    targetKind: 'private_feedback_handling' as const,
    propertyId: null,
    durationMinutes: 2_880,
    policyVersion: 1,
  })),
  setPrivateFeedbackPropertyOverride: vi.fn(async () => ({
    scope: 'property' as const,
    targetKind: 'private_feedback_handling' as const,
    propertyId: PROPERTY,
    durationMinutes: 720,
    policyVersion: 1,
  })),
})

describe('setResponseTargetPolicy', () => {
  it('lets an Organization administrator set the private default and Property override', async () => {
    const store = policyStore()
    const execute = setResponseTargetPolicy({ store, clock: () => NOW })
    const ctx = createScopedAuthContext({
      organizationId: ORG,
      userId: USER,
      permissions: [['organization.update', 'organization']],
    })

    await execute(
      {
        scope: 'organization',
        targetKind: 'private_feedback_handling',
        durationMinutes: 2_880,
        expectedPolicyVersion: null,
      },
      ctx,
    )
    await execute(
      {
        scope: 'property',
        propertyId: PROPERTY,
        durationMinutes: 720,
        expectedPolicyVersion: null,
      },
      ctx,
    )

    expect(store.setOrganizationPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, actorUserId: USER, at: NOW }),
    )
    expect(store.setPrivateFeedbackPropertyOverride).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: PROPERTY, durationMinutes: 720 }),
    )
  })

  it('rejects assigned-scope mutation and forbids a Google Property override', async () => {
    const store = policyStore()
    const assigned = createScopedAuthContext({
      organizationId: ORG,
      userId: USER,
      permissions: [['organization.update', 'assigned-properties']],
    })
    const accountAdmin = createScopedAuthContext({
      organizationId: ORG,
      userId: USER,
      permissions: [['organization.update', 'organization']],
    })
    const execute = setResponseTargetPolicy({ store, clock: () => NOW })

    await expect(
      execute(
        {
          scope: 'organization',
          targetKind: 'private_feedback_handling',
          durationMinutes: 2_880,
          expectedPolicyVersion: null,
        },
        assigned,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      execute(
        {
          scope: 'property',
          propertyId: PROPERTY,
          targetKind: 'google_review_response' as never,
          durationMinutes: 720,
          expectedPolicyVersion: null,
        },
        accountAdmin,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(store.setOrganizationPolicy).not.toHaveBeenCalled()
    expect(store.setPrivateFeedbackPropertyOverride).not.toHaveBeenCalled()
  })
})
