import { afterEach, describe, expect, it } from 'vitest'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { isEmailDeliveryAllowed } from './read-and-notify-contexts'

// Feed's delivery-lag evidence must judge only mail that may be sent. The
// decision is the process policy store's scoped `notification.send_email`
// posture — the same allowlist, suspension and kill switch that gate the
// email jobs — so a capability-dark Organization's pending rows never read as
// late mail.
describe('isEmailDeliveryAllowed', () => {
  afterEach(() => {
    resetCapabilityPolicyStore()
  })

  it('allows only an allowlisted, unsuspended Organization', () => {
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({
        BETA_ALLOWLIST_ORGS: 'org-pilot,org-suspended',
        BETA_SUSPENDED_ORGS: 'org-suspended',
      }),
    )

    expect(
      isEmailDeliveryAllowed({ organizationId: 'org-pilot', propertyId: 'p-1' }),
    ).toBe(true)
    expect(
      isEmailDeliveryAllowed({ organizationId: 'org-pilot', propertyId: null }),
    ).toBe(true)
    expect(
      isEmailDeliveryAllowed({ organizationId: 'org-dark', propertyId: 'p-2' }),
    ).toBe(false)
    expect(
      isEmailDeliveryAllowed({ organizationId: 'org-suspended', propertyId: 'p-3' }),
    ).toBe(false)
  })

  it('judges an Organization-scoped mandatory row under the mandatory capability', () => {
    initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))

    // Mandatory mail leaves whatever the allowlist says, so a mandatory row
    // stuck in a scope the allowlist never named IS late mail, not a dark one.
    expect(isEmailDeliveryAllowed({ organizationId: 'org-dark', propertyId: null })).toBe(
      true,
    )
    expect(
      isEmailDeliveryAllowed({ organizationId: 'org-dark', propertyId: 'p-1' }),
    ).toBe(false)
  })

  it('denies every scope while the capability is killed', () => {
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({
        BETA_ALLOWLIST_ORGS: 'org-pilot',
        BETA_CAPABILITIES_OFF:
          'notification.send_email,notification.send_mandatory_email',
      }),
    )

    expect(
      isEmailDeliveryAllowed({ organizationId: 'org-pilot', propertyId: 'p-1' }),
    ).toBe(false)
    expect(
      isEmailDeliveryAllowed({ organizationId: 'org-pilot', propertyId: null }),
    ).toBe(false)
  })
})
