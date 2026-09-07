import { describe, expect, it } from 'vitest'
import {
  PROPERTY_PURGE_PLAN,
  propertyClosingLifecycleReason,
} from './property-organization-lifecycle.adapter'

const LINEAGE = '7c1f3a9d-2b4e-4c6a-9d8f-0e1a2b3c4d5e'

describe('Property Organization lifecycle contributor', () => {
  it('stamps the closure lineage into the suspension reason so it can be restored', () => {
    const reason = propertyClosingLifecycleReason(LINEAGE)
    expect(reason).toBe(`organization_closure:${LINEAGE}`)
    // A tenant's own suspension reason can never collide with it.
    expect(reason.startsWith('organization_closure:')).toBe(true)
  })

  it('names a bounded purge plan that drops nothing and stays inside Property', () => {
    expect([...PROPERTY_PURGE_PLAN]).toEqual([
      'idempotency_receipts',
      'property_responsible_managers',
      'properties',
    ])
    for (const table of PROPERTY_PURGE_PLAN) {
      expect(table).not.toMatch(/drop|truncate/i)
    }
    // Other owners' rows are never in a Property plan.
    for (const foreign of ['portals', 'guest_responses', 'google_connections', 'user']) {
      expect(PROPERTY_PURGE_PLAN).not.toContain(foreign)
    }
  })
})
