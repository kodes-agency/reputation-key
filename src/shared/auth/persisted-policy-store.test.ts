// BQC-2.2 — persisted capability-policy store (unit, no DB).
//
// The persisted store serves CapabilityPolicyStore decisions from an
// in-memory snapshot of the DB policy tables. Refresh is version-gated
// (policy_version), so revocation/suspension takes effect within the
// configured refresh interval — the measured bound required by phase
// BQC-2 §2.2. Never-installed-unloaded state fails closed.
//
// The composite store is the production shape: global posture (core sets,
// kill switch, e2e overrides) stays with the env store; tenant state
// (allowlists, suspensions) comes from the persisted snapshot.

import { describe, it, expect, vi } from 'vitest'
import {
  createPersistedPolicyStore,
  createCompositePolicyStore,
  snapshotFromEnv,
  type PolicySnapshot,
} from './persisted-policy-store'
import { createEnvCapabilityPolicyStore } from './beta-capabilities'

function snapshot(overrides: Partial<PolicySnapshot> = {}): PolicySnapshot {
  return {
    version: 1,
    orgPolicies: [],
    orgCapabilities: [],
    propertyPolicies: [],
    propertyCapabilities: [],
    orgAllowlistAll: [],
    propertyAllowlistAll: [],
    ...overrides,
  }
}

function loader(initial: PolicySnapshot) {
  let current = initial
  const loadSnapshot = vi.fn(async () => current)
  const loadVersion = vi.fn(async () => current.version)
  return {
    loadSnapshot,
    loadVersion,
    set(snap: PolicySnapshot) {
      current = snap
    },
  }
}

describe('persisted policy store (BQC-2.2)', () => {
  it('fails closed before the first successful refresh', () => {
    const l = loader(snapshot())
    const store = createPersistedPolicyStore(l)
    expect(store.isOrgSuspended('org-1')).toBe(true)
    expect(store.isPropertySuspended('prop-1')).toBe(true)
    expect(store.isOrgAllowlisted('org-1', 'team.use')).toBe(false)
    expect(store.isPropertyAllowlisted('prop-1', 'portal.read')).toBe(false)
    // Never installed unwrapped: global enablement denies too (loud, fail-closed).
    expect(store.isCapabilityGloballyEnabled('property.create')).toBe(false)
    expect(store.currentVersion()).toBeNull()
  })

  it('loads the snapshot on refresh when the version differs', async () => {
    const l = loader(
      snapshot({
        version: 7,
        orgPolicies: [
          {
            organizationId: 'org-sus',
            cohort: 'beta',
            suspendedAt: new Date('2026-07-17T00:00:00Z'),
            suspendedReason: 't-1',
          },
        ],
        orgCapabilities: [{ organizationId: 'org-ok', capability: 'team.use' }],
      }),
    )
    const store = createPersistedPolicyStore(l)
    await store.refresh()
    expect(store.currentVersion()).toBe(7)
    expect(store.isOrgSuspended('org-sus')).toBe(true)
    expect(store.isOrgAllowlisted('org-ok', 'team.use')).toBe(true)
    expect(store.isOrgAllowlisted('org-ok', 'goal.use')).toBe(false)
    expect(l.loadSnapshot).toHaveBeenCalledTimes(1)
  })

  it('skips the reload when the version is unchanged', async () => {
    const l = loader(snapshot({ version: 3 }))
    const store = createPersistedPolicyStore(l)
    await store.refresh()
    await store.refresh()
    await store.refresh()
    expect(l.loadVersion).toHaveBeenCalledTimes(3)
    expect(l.loadSnapshot).toHaveBeenCalledTimes(1)
  })

  it('keeps the previous snapshot and reports when refresh fails', async () => {
    const l = loader(snapshot({ version: 5 }))
    const onRefreshError = vi.fn()
    const store = createPersistedPolicyStore({ ...l, onRefreshError })
    await store.refresh()
    expect(store.currentVersion()).toBe(5)

    l.loadVersion.mockRejectedValueOnce(new Error('db down'))
    l.set(
      snapshot({
        version: 6,
        orgCapabilities: [{ organizationId: 'o', capability: 'x.y' }],
      }),
    )
    await store.refresh()
    expect(onRefreshError).toHaveBeenCalledTimes(1)
    expect(store.currentVersion()).toBe(5) // stale but consistent
  })

  it('seeds from env for bootstrap parity (BETA_ALLOWLIST_ORGS / BETA_SUSPENDED_ORGS)', () => {
    const seeded = snapshotFromEnv({
      BETA_ALLOWLIST_ORGS: 'org-a, org-b',
      BETA_SUSPENDED_ORGS: 'org-z',
    })
    const l = loader(snapshot())
    const store = createPersistedPolicyStore({ ...l, initialSnapshot: seeded })
    // Before any refresh, env semantics hold (no fail-closed window on web boot).
    expect(store.isOrgAllowlisted('org-a', 'team.use')).toBe(true)
    expect(store.isOrgAllowlisted('org-b', 'portal.read')).toBe(true)
    expect(store.isOrgSuspended('org-z')).toBe(true)
    expect(store.isOrgSuspended('org-a')).toBe(false)
    // Env seed is always stale (version -1) — first refresh replaces it with DB truth.
    expect(store.currentVersion()).toBe(-1)
  })

  it('unions the env seed with the DB snapshot after refresh (env stays an operator lever)', async () => {
    const seeded = snapshotFromEnv({
      BETA_ALLOWLIST_ORGS: 'org-env',
      BETA_SUSPENDED_ORGS: '',
    })
    const l = loader(
      snapshot({
        version: 9,
        orgCapabilities: [{ organizationId: 'org-db', capability: 'goal.use' }],
      }),
    )
    const store = createPersistedPolicyStore({ ...l, initialSnapshot: seeded })
    await store.refresh()
    expect(store.currentVersion()).toBe(9)
    // DB row honored…
    expect(store.isOrgAllowlisted('org-db', 'goal.use')).toBe(true)
    // …and the env seed is NOT lost (union semantics).
    expect(store.isOrgAllowlisted('org-env', 'team.use')).toBe(true)
  })

  it('refreshes on the polling interval until stopped', async () => {
    vi.useFakeTimers()
    try {
      const l = loader(snapshot({ version: 1 }))
      const store = createPersistedPolicyStore(l)
      const stop = store.startPolling(1000)
      await vi.advanceTimersByTimeAsync(2500)
      expect(l.loadVersion.mock.calls.length).toBeGreaterThanOrEqual(2)
      l.set(snapshot({ version: 2 }))
      await vi.advanceTimersByTimeAsync(1000)
      expect(store.currentVersion()).toBe(2)
      stop()
      const calls = l.loadVersion.mock.calls.length
      await vi.advanceTimersByTimeAsync(3000)
      expect(l.loadVersion.mock.calls.length).toBe(calls)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('composite policy store (BQC-2.2)', () => {
  it('delegates global posture to env and tenant state to the persisted store', async () => {
    const env = createEnvCapabilityPolicyStore({
      BETA_CAPABILITIES_OFF: 'team.use', // kill switch stays env-authoritative
    })
    const l = loader(
      snapshot({
        version: 1,
        orgCapabilities: [{ organizationId: 'org-1', capability: 'team.use' }],
        orgPolicies: [
          {
            organizationId: 'org-2',
            cohort: 'beta',
            suspendedAt: new Date(),
            suspendedReason: null,
          },
        ],
      }),
    )
    const persisted = createPersistedPolicyStore(l)
    await persisted.refresh()

    const store = createCompositePolicyStore({ globalStore: env, tenantStore: persisted })
    // Kill switch wins over a DB allowlist row.
    expect(store.isCapabilityGloballyEnabled('team.use')).toBe(false)
    // Core still on via env; blocked still off.
    expect(store.isCapabilityGloballyEnabled('property.create')).toBe(true)
    expect(store.isCapabilityGloballyEnabled('portal.write')).toBe(false)
    // Tenant state from the persisted snapshot.
    expect(store.isOrgAllowlisted('org-1', 'team.use')).toBe(true)
    expect(store.isOrgSuspended('org-2')).toBe(true)
    expect(store.isOrgSuspended('org-1')).toBe(false)
  })
})
