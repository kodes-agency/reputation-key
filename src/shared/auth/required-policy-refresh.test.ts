import { describe, expect, it, vi } from 'vitest'
import { createPersistedPolicyStore, type PolicySnapshot } from './persisted-policy-store'

const snapshot = (over: Partial<PolicySnapshot> = {}): PolicySnapshot => ({
  version: 7,
  emergencyKillVersion: 3,
  killedCapabilities: [],
  orgPolicies: [],
  orgCapabilities: [],
  propertyPolicies: [],
  propertyCapabilities: [],
  orgAllowlistAll: [],
  propertyAllowlistAll: [],
  ...over,
})

describe('required policy refresh', () => {
  it('returns authoritative policy and emergency-kill generations', async () => {
    const store = createPersistedPolicyStore({
      loadControlVersion: async () => ({ version: 7, emergencyKillVersion: 3 }),
      loadSnapshot: async () => snapshot(),
    })

    await expect(store.refreshRequired()).resolves.toEqual({
      version: 7,
      emergencyKillVersion: 3,
    })
    expect(store.currentVersion()).toBe(7)
    expect(store.currentEmergencyKillVersion()).toBe(3)
  })

  it('reloads when only the emergency-kill generation changes', async () => {
    const loadSnapshot = vi
      .fn<() => Promise<PolicySnapshot>>()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(
        snapshot({
          emergencyKillVersion: 4,
          killedCapabilities: ['property.import_gbp_v2'],
        }),
      )
    const loadControlVersion = vi
      .fn<() => Promise<{ version: number; emergencyKillVersion: number }>>()
      .mockResolvedValueOnce({ version: 7, emergencyKillVersion: 3 })
      .mockResolvedValueOnce({ version: 7, emergencyKillVersion: 4 })
    const store = createPersistedPolicyStore({ loadControlVersion, loadSnapshot })

    await expect(store.refreshRequired()).resolves.toEqual({
      version: 7,
      emergencyKillVersion: 3,
    })
    await expect(store.refreshRequired()).resolves.toEqual({
      version: 7,
      emergencyKillVersion: 4,
    })
    expect(store.isCapabilityKilled?.('property.import_gbp_v2')).toBe(true)
    expect(loadSnapshot).toHaveBeenCalledTimes(2)
  })

  it('fails closed instead of converting a loader failure into cached authority', async () => {
    const onRefreshError = vi.fn()
    const store = createPersistedPolicyStore({
      loadControlVersion: async () => {
        throw new Error('policy store unavailable')
      },
      loadSnapshot: async () => snapshot(),
      initialSnapshot: snapshot(),
      onRefreshError,
    })

    await expect(store.refreshRequired()).resolves.toEqual({ unavailable: true })
    expect(onRefreshError).toHaveBeenCalledOnce()
    expect(store.currentVersion()).toBe(7)
  })

  it('rejects a snapshot that does not match the control generations', async () => {
    const store = createPersistedPolicyStore({
      loadControlVersion: async () => ({ version: 8, emergencyKillVersion: 4 }),
      loadSnapshot: async () => snapshot({ version: 8, emergencyKillVersion: 3 }),
    })

    await expect(store.refreshRequired()).resolves.toEqual({ unavailable: true })
  })
})
