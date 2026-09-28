// "Is this controlled-beta capability live for everyone here?" is not the
// global question. checkGlobalCapability answers false for every non-core
// capability, so production — which admits every Organization through
// BETA_ALLOWLIST_ORGS=* — reported outbound email as capability-dark, and the
// email-stalled alert treated an untouched overdue backlog as expected.

import { afterEach, describe, expect, it } from 'vitest'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  isCapabilityOpenToEveryOrganization,
  resetCapabilityPolicyStore,
  type CapabilityPolicyEnv,
} from './beta-capabilities'

function openToEveryone(env: CapabilityPolicyEnv): boolean {
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore(env))
  return isCapabilityOpenToEveryOrganization('notification.send_email')
}

afterEach(() => resetCapabilityPolicyStore())

describe('a capability open to every Organization', () => {
  it('is open under BETA_ALLOWLIST_ORGS=*', () => {
    expect(openToEveryone({ BETA_ALLOWLIST_ORGS: '*' })).toBe(true)
  })

  it('is not open when the allowlist names Organizations, or none', () => {
    expect(openToEveryone({ BETA_ALLOWLIST_ORGS: 'org-a,org-b' })).toBe(false)
    expect(openToEveryone({})).toBe(false)
  })

  it('loses to the kill switch, whole or per capability', () => {
    expect(
      openToEveryone({
        BETA_ALLOWLIST_ORGS: '*',
        BETA_CAPABILITIES_OFF: 'notification.send_email',
      }),
    ).toBe(false)
    expect(
      openToEveryone({ BETA_ALLOWLIST_ORGS: '*', BETA_CAPABILITIES_OFF: 'all' }),
    ).toBe(false)
  })

  it('never opens a blocked capability', () => {
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({ BETA_ALLOWLIST_ORGS: '*' }),
    )
    expect(isCapabilityOpenToEveryOrganization('identity.register')).toBe(false)
  })
})
