import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_POLICY_VERSION,
  createEnvCapabilityPolicyStore,
  isBlockedCapability,
  listAllCapabilities,
} from './beta-capabilities'
import { EXECUTION_POLICY_VERSION } from './execution-policy'
import { capabilityForPermission } from './capability-for-permission'

describe('Google Content capability foundation', () => {
  it('keeps both capabilities in the vocabulary and unblocked', () => {
    expect(listAllCapabilities()).toEqual(
      expect.arrayContaining(['property.import_gbp_v2', 'property.read_gbp_performance']),
    )
    expect(isBlockedCapability('property.import_gbp_v2')).toBe(false)
    expect(isBlockedCapability('property.read_gbp_performance')).toBe(false)
  })
  it('maps each feature permission to its independent capability', () => {
    expect(capabilityForPermission('property.import_gbp_v2')).toBe(
      'property.import_gbp_v2',
    )
    expect(capabilityForPermission('property.read_gbp_performance')).toBe(
      'property.read_gbp_performance',
    )
  })

  it('versions capability posture independently from execution semantics', () => {
    expect(CAPABILITY_POLICY_VERSION).toBe('beta-local-13')
    expect(EXECUTION_POLICY_VERSION).toBe('beta-local-2')
  })

  it('runs both by default and stops both with the Google switch', () => {
    const open = createEnvCapabilityPolicyStore({})
    expect(open.isCapabilityKilled('property.import_gbp_v2')).toBe(false)
    expect(open.isCapabilityKilled('property.read_gbp_performance')).toBe(false)

    const googleOff = createEnvCapabilityPolicyStore({ BETA_CAPABILITIES_OFF: 'google' })
    expect(googleOff.isCapabilityKilled('property.import_gbp_v2')).toBe(true)
    expect(googleOff.isCapabilityKilled('property.read_gbp_performance')).toBe(true)
  })
})
