import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_POLICY_VERSION,
  createEnvCapabilityPolicyStore,
  isBlockedCapability,
  isCoreCapability,
  listAllCapabilities,
} from './beta-capabilities'
import { EXECUTION_POLICY_VERSION } from './execution-policy'
import { capabilityForPermission } from './capability-for-permission'

describe('Google Content capability foundation', () => {
  it('adds both capabilities as non-core, non-blocked beta capabilities', () => {
    expect(listAllCapabilities()).toEqual(
      expect.arrayContaining(['property.import_gbp_v2', 'property.read_gbp_performance']),
    )
    expect(isCoreCapability('property.import_gbp_v2')).toBe(false)
    expect(isCoreCapability('property.read_gbp_performance')).toBe(false)
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
    expect(CAPABILITY_POLICY_VERSION).toBe('beta-local-5')
    expect(EXECUTION_POLICY_VERSION).toBe('beta-local-2')
  })

  it('keeps the capabilities denied by default and independently killable', () => {
    const denied = createEnvCapabilityPolicyStore({})
    expect(denied.isCapabilityGloballyEnabled('property.import_gbp_v2')).toBe(false)
    expect(denied.isCapabilityGloballyEnabled('property.read_gbp_performance')).toBe(
      false,
    )

    const killedImport = createEnvCapabilityPolicyStore({
      BETA_E2E_GLOBAL_CAPABILITIES:
        'property.import_gbp_v2,property.read_gbp_performance',
      BETA_CAPABILITIES_OFF: 'property.import_gbp_v2',
    })
    expect(killedImport.isCapabilityKilled?.('property.import_gbp_v2')).toBe(true)
    expect(killedImport.isCapabilityKilled?.('property.read_gbp_performance')).toBe(false)
  })
})
