import { describe, expect, it } from 'vitest'
import { classifyUserOrganizationBinding } from './user-organization-binding-audit'

describe('classifyUserOrganizationBinding', () => {
  it.each([
    {
      name: 'exact active binding',
      memberships: ['org-a'],
      binding: { organizationId: 'org-a', state: 'active' as const },
      expected: 'exact',
    },
    {
      name: 'one unbound membership',
      memberships: ['org-a'],
      binding: null,
      expected: 'mappable',
    },
    {
      name: 'duplicate rows for the same Organization',
      memberships: ['org-a', 'org-a'],
      binding: { organizationId: 'org-a', state: 'active' as const },
      expected: 'exact',
    },
    {
      name: 'multiple Organizations',
      memberships: ['org-a', 'org-b'],
      binding: { organizationId: null, state: 'support_resolution' as const },
      expected: 'conflict',
    },
    {
      name: 'binding and membership disagree',
      memberships: ['org-a'],
      binding: { organizationId: 'org-b', state: 'active' as const },
      expected: 'conflict',
    },
    {
      name: 'unresolved binding despite one membership',
      memberships: ['org-a'],
      binding: { organizationId: null, state: 'support_resolution' as const },
      expected: 'conflict',
    },
    {
      name: 'account without membership',
      memberships: [],
      binding: null,
      expected: 'orphan',
    },
    {
      name: 'stale binding without membership',
      memberships: [],
      binding: { organizationId: 'org-a', state: 'active' as const },
      expected: 'orphan',
    },
  ])('$name → $expected', ({ memberships, binding, expected }) => {
    expect(
      classifyUserOrganizationBinding({
        membershipOrganizationIds: memberships,
        binding,
      }),
    ).toBe(expected)
  })
})
