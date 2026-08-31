import { describe, expect, it } from 'vitest'
import { decideUserOrganizationBinding } from './user-organization-binding'

describe('closed-beta user Organization binding', () => {
  it('allows only the exact active Organization and exposes its version', () => {
    expect(
      decideUserOrganizationBinding(
        {
          userId: 'user-1',
          organizationId: 'org-1',
          state: 'active',
          version: 4,
        },
        'org-1',
      ),
    ).toEqual({ kind: 'allow', version: 4 })
  })

  it('requires support when the session selects another Organization', () => {
    expect(
      decideUserOrganizationBinding(
        {
          userId: 'user-1',
          organizationId: 'org-1',
          state: 'active',
          version: 4,
        },
        'org-2',
      ),
    ).toEqual({ kind: 'deny', reason: 'organization_binding_mismatch' })
  })

  it('fails closed for missing, unresolved, and released bindings', () => {
    expect(decideUserOrganizationBinding(null, 'org-1')).toEqual({
      kind: 'deny',
      reason: 'organization_binding_missing',
    })
    expect(
      decideUserOrganizationBinding(
        {
          userId: 'user-1',
          organizationId: null,
          state: 'support_resolution',
          version: 2,
        },
        'org-1',
      ),
    ).toEqual({ kind: 'deny', reason: 'organization_binding_unresolved' })
    expect(
      decideUserOrganizationBinding(
        {
          userId: 'user-1',
          organizationId: 'org-1',
          state: 'released',
          version: 3,
        },
        'org-1',
      ),
    ).toEqual({ kind: 'deny', reason: 'organization_binding_released' })
  })
})
