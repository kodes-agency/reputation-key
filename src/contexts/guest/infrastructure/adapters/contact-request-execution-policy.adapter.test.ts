import { describe, expect, it, vi } from 'vitest'
import type { ExecutionPolicy } from '#/shared/auth/execution-policy'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { organizationId } from '#/shared/domain/ids'
import { createContactRequestExecutionPolicyAdapter } from './contact-request-execution-policy.adapter'

describe('Contact Request ExecutionPolicy adapter', () => {
  it('delegates the exact interactive contact capability request to ExecutionPolicy', async () => {
    const decide = vi.fn().mockResolvedValue({
      allowed: false,
      reason: 'capability_safety_blocked',
      action: 'feedback.contact_read',
      policyVersion: 'beta-local-2',
    })
    const policy = { decide } as Pick<ExecutionPolicy, 'decide'>
    const adapter = createContactRequestExecutionPolicyAdapter(policy)
    const ctx = buildTestAuthContext({ organizationId: organizationId('org-a') })
    const request = {
      principal: { kind: 'user' as const, ctx },
      action: 'feedback.contact_read' as const,
      capability: 'portal.guest_contact' as const,
      organizationId: 'org-a',
      propertyId: '10000000-0000-4000-8000-000000000002',
      executionKind: 'interactive' as const,
      reason: 'respond_to_contact_request' as const,
      now: new Date('2026-08-26T09:00:00.000Z'),
    }

    await expect(adapter.decide(request)).resolves.toEqual({
      allowed: false,
      reason: 'capability_safety_blocked',
    })
    expect(decide).toHaveBeenCalledWith(request)
  })
})
