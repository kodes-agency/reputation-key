import { afterEach, describe, expect, it } from 'vitest'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { isEmailDeliveryAllowed } from './read-and-notify-contexts'

// Feed's delivery-lag evidence must judge only mail that may be sent. The
// decision is the process policy store's scoped `notification.send_email`
// posture — the same switch, suspension and everything-off that gate the
// email jobs — so a suspended Organization's pending rows never read as late
// mail.
describe('isEmailDeliveryAllowed', () => {
  afterEach(() => {
    resetCapabilityPolicyStore()
  })

  it('allows every Organization but a suspended one', () => {
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({ BETA_SUSPENDED_ORGS: 'org-suspended' }),
    )

    expect(
      isEmailDeliveryAllowed({ organizationId: 'org-pilot', propertyId: 'p-1' }),
    ).toBe(true)
    expect(
      isEmailDeliveryAllowed({ organizationId: 'org-pilot', propertyId: null }),
    ).toBe(true)
    expect(
      isEmailDeliveryAllowed({ organizationId: 'org-suspended', propertyId: 'p-3' }),
    ).toBe(false)
  })

  it('judges an Organization-scoped mandatory row under the mandatory capability', () => {
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({ BETA_CAPABILITIES_OFF: 'optional_email' }),
    )

    // Mandatory mail leaves while optional email is off, so a stuck mandatory
    // row IS late mail, not a switched-off one.
    expect(isEmailDeliveryAllowed({ organizationId: 'org-1', propertyId: null })).toBe(
      true,
    )
    expect(isEmailDeliveryAllowed({ organizationId: 'org-1', propertyId: 'p-1' })).toBe(
      false,
    )
  })

  it('denies every scope while everything is off', () => {
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({ BETA_CAPABILITIES_OFF: 'all' }),
    )

    expect(isEmailDeliveryAllowed({ organizationId: 'org-1', propertyId: 'p-1' })).toBe(
      false,
    )
    expect(isEmailDeliveryAllowed({ organizationId: 'org-1', propertyId: null })).toBe(
      false,
    )
  })
})
