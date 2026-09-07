import { describe, expect, it } from 'vitest'
import { decideUserOrganizationMembership } from './user-organization-membership'

describe('closed-beta user Organization membership', () => {
  it('allows the one Organization represented by Better Auth membership', () => {
    expect(decideUserOrganizationMembership(['org-1'], 'org-1')).toEqual({
      kind: 'allow',
    })
    expect(decideUserOrganizationMembership(['org-1', 'org-1'], 'org-1')).toEqual({
      kind: 'allow',
    })
  })

  it('rejects a session that selects another Organization', () => {
    expect(decideUserOrganizationMembership(['org-1'], 'org-2')).toEqual({
      kind: 'deny',
      reason: 'organization_membership_mismatch',
    })
  })

  it('fails closed for missing and ambiguous memberships', () => {
    expect(decideUserOrganizationMembership([], 'org-1')).toEqual({
      kind: 'deny',
      reason: 'organization_membership_missing',
    })
    expect(decideUserOrganizationMembership(['org-1', 'org-2'], 'org-1')).toEqual({
      kind: 'deny',
      reason: 'organization_membership_ambiguous',
    })
  })
})
