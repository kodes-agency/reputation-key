import { describe, expect, it } from 'vitest'
import { STAFF_LIFECYCLE_TABLES } from './staff-organization-lifecycle.adapter'

describe('Staff Organization lifecycle contribution', () => {
  it('names the exact reviewed Staff tables in FK-safe delete order', () => {
    expect(STAFF_LIFECYCLE_TABLES).toEqual([
      'portal_responsibilities',
      'portal_group_memberships',
      'staff_participations',
      'staff_user_links',
      'staff_participants',
    ])
    // Identity owns the property-access authority and every user identity row;
    // a Staff purge that touched them would erase a person who belongs to
    // another Organization.
    for (const foreign of [
      'property_access_grants',
      'property_access_grant',
      'user',
      'member',
      'session',
    ]) {
      expect(STAFF_LIFECYCLE_TABLES).not.toContain(foreign)
    }
  })
})
