import { afterEach, describe, expect, it } from 'vitest'
import {
  checkScopedCapability,
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  listBlockedCapabilities,
  resetCapabilityPolicyStore,
} from './beta-capabilities'
import { capabilityForPermission } from './capability-for-permission'

describe('LIF-01 Property lifecycle containment', () => {
  afterEach(() => resetCapabilityPolicyStore())

  it('keeps destructive product deletion behind an unpromotable capability', () => {
    const capability = capabilityForPermission('property.delete')
    const store = createEnvCapabilityPolicyStore({
      BETA_ALLOWLIST_ORGS: 'org-1',
      BETA_E2E_GLOBAL_CAPABILITIES: 'property.erase',
    })
    initCapabilityPolicyStore(store)

    expect(capability).toBe('property.erase')
    expect(listBlockedCapabilities()).toContain('property.erase')
    expect(
      checkScopedCapability(
        { organizationId: 'org-1', propertyId: 'property-1' },
        capability,
      ),
    ).toEqual({
      allowed: false,
      reason: 'capability_blocked',
      capability: 'property.erase',
    })
  })
})
