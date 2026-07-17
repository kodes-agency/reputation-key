// Persisted capability-policy store (BQC-2.2 / ADR 0032, phase BQC-2 §2.2).
//
// Serves CapabilityPolicyStore tenant decisions from an in-memory snapshot of
// the DB policy tables (organization/property policy + capability allowlists).
// Refresh is version-gated on the global policy_version: a refresh compares
// versions and only reloads on change, so revocation/suspension takes effect
// within the configured polling interval — the measured bound required by the
// phase. loadVersion is a single cheap row read; loadSnapshot runs only when
// the version moved.
//
// Fail-closed: a store that has never successfully refreshed (and has no env
// seed) reports every org/property suspended and nothing allowlisted.
//
// Production shape is the COMPOSITE store below: global posture (core sets,
// kill switch, e2e overrides) stays with the env store; tenant state comes
// from this persisted snapshot. The env seed (BETA_ALLOWLIST_ORGS /
// BETA_SUSPENDED_ORGS) is unioned in forever — env remains the operator
// emergency lever; the DB is authoritative for persisted policy.
//
// This module must stay drizzle-free (eslint boundary): SQL lives in the
// identity infrastructure repositories; loaders are injected.

import { isCoreCapability, isBlockedCapability } from './beta-capabilities'
import type { CapabilityPolicyStore, CapabilityPolicyEnv } from './beta-capabilities'

// ── Snapshot types (shared contract: identity infra produces, this store consumes) ──

export type OrgPolicyRecord = Readonly<{
  organizationId: string
  cohort: string
  suspendedAt: Date | null
  suspendedReason: string | null
}>

export type PropertyPolicyRecord = Readonly<{
  propertyId: string
  suspendedAt: Date | null
  suspendedReason: string | null
}>

export type OrgCapabilityRecord = Readonly<{ organizationId: string; capability: string }>
export type PropertyCapabilityRecord = Readonly<{
  propertyId: string
  capability: string
}>

export type PolicySnapshot = Readonly<{
  /** Global policy_version at load time. -1 marks an env seed (always stale). */
  version: number
  orgPolicies: ReadonlyArray<OrgPolicyRecord>
  orgCapabilities: ReadonlyArray<OrgCapabilityRecord>
  propertyPolicies: ReadonlyArray<PropertyPolicyRecord>
  propertyCapabilities: ReadonlyArray<PropertyCapabilityRecord>
  /** Orgs allowlisted for ALL non-core capabilities (env-parity wildcard). */
  orgAllowlistAll: ReadonlyArray<string>
  /** Properties allowlisted for ALL capabilities (env-parity wildcard). */
  propertyAllowlistAll: ReadonlyArray<string>
}>

export type PolicySnapshotLoader = () => Promise<PolicySnapshot>
export type PolicyVersionLoader = () => Promise<number>

// ── Env seed (bootstrap parity for the web process) ──────────────────

/**
 * Builds a PolicySnapshot from the operator env allowlist/suspension vars.
 * Version -1 marks the seed as always-stale: the first refresh replaces the
 * DB side while the seed keeps unioning in (see store semantics).
 */
export function snapshotFromEnv(env: CapabilityPolicyEnv): PolicySnapshot {
  const split = (raw: string | undefined) =>
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  return {
    version: -1,
    orgPolicies: split(env.BETA_SUSPENDED_ORGS).map((organizationId) => ({
      organizationId,
      cohort: 'beta',
      suspendedAt: new Date(0),
      suspendedReason: 'env:BETA_SUSPENDED_ORGS',
    })),
    orgCapabilities: [],
    propertyPolicies: [],
    propertyCapabilities: [],
    orgAllowlistAll: split(env.BETA_ALLOWLIST_ORGS),
    propertyAllowlistAll: [],
  }
}

// ── Persisted store ──────────────────────────────────────────────────

export type PersistedPolicyStoreDeps = Readonly<{
  loadSnapshot: PolicySnapshotLoader
  loadVersion: PolicyVersionLoader
  /** Env seed (snapshotFromEnv) — bootstrap parity + permanent union. */
  initialSnapshot?: PolicySnapshot
  onRefreshError?: (err: unknown) => void
}>

export type PersistedPolicyStore = CapabilityPolicyStore &
  Readonly<{
    /** Version-gated reload. Never throws — keeps the previous snapshot. */
    refresh(): Promise<void>
    /** Loaded DB version; null when nothing (not even a seed) is present. */
    currentVersion(): number | null
    /** Poll loadVersion every intervalMs; returns a stop function. */
    startPolling(intervalMs: number): () => void
  }>

export function createPersistedPolicyStore(
  deps: PersistedPolicyStoreDeps,
): PersistedPolicyStore {
  const seed = deps.initialSnapshot ?? null
  let current: PolicySnapshot | null = seed

  const orgAllowlistAll = new Set(seed?.orgAllowlistAll ?? [])
  const propertyAllowlistAll = new Set(seed?.propertyAllowlistAll ?? [])
  const seedSuspendedOrgs = new Set(
    (seed?.orgPolicies ?? []).filter((p) => p.suspendedAt).map((p) => p.organizationId),
  )
  const seedSuspendedProperties = new Set(
    (seed?.propertyPolicies ?? []).filter((p) => p.suspendedAt).map((p) => p.propertyId),
  )

  const store: PersistedPolicyStore = {
    // Never installed unwrapped in production — the composite supplies global
    // posture from env. Denying here keeps accidental standalone use loud
    // (fail-closed) rather than a silent kill-switch bypass.
    isCapabilityGloballyEnabled: () => false,

    isOrgAllowlisted: (orgId, cap) => {
      // Core capabilities don't need allowlisting (env-store parity);
      // blocked capabilities are never allowlisted.
      if (isCoreCapability(cap)) return true
      if (isBlockedCapability(cap)) return false
      if (orgAllowlistAll.has(orgId)) return true
      return (
        current?.orgCapabilities.some(
          (c) => c.organizationId === orgId && c.capability === cap,
        ) ?? false
      )
    },

    isPropertyAllowlisted: (propertyId, cap) => {
      if (isCoreCapability(cap)) return true
      if (isBlockedCapability(cap)) return false
      if (propertyAllowlistAll.has(propertyId)) return true
      return (
        current?.propertyCapabilities.some(
          (c) => c.propertyId === propertyId && c.capability === cap,
        ) ?? false
      )
    },

    isOrgSuspended: (orgId) => {
      if (seedSuspendedOrgs.has(orgId)) return true
      if (!current) return !seed // fail closed with no seed and no snapshot
      return (
        current.orgPolicies.find((p) => p.organizationId === orgId)?.suspendedAt != null
      )
    },

    isPropertySuspended: (propertyId) => {
      if (seedSuspendedProperties.has(propertyId)) return true
      if (!current) return !seed
      return (
        current.propertyPolicies.find((p) => p.propertyId === propertyId)?.suspendedAt !=
        null
      )
    },

    async refresh() {
      try {
        const version = await deps.loadVersion()
        if (current && version === current.version) return
        current = await deps.loadSnapshot()
      } catch (err) {
        deps.onRefreshError?.(err)
      }
    },

    currentVersion: () => current?.version ?? null,

    startPolling(intervalMs) {
      const timer = setInterval(() => void store.refresh(), intervalMs)
      if (typeof timer.unref === 'function') timer.unref()
      return () => clearInterval(timer)
    },
  }

  return store
}

// ── Composite store (production shape) ───────────────────────────────

/**
 * Global posture (core sets, kill switch, e2e overrides, blocked) from the
 * env store; tenant state (org/property allowlist + suspension) from the
 * persisted snapshot store.
 */
export function createCompositePolicyStore(deps: {
  globalStore: CapabilityPolicyStore
  tenantStore: CapabilityPolicyStore
}): CapabilityPolicyStore {
  return {
    isCapabilityGloballyEnabled: (cap) =>
      deps.globalStore.isCapabilityGloballyEnabled(cap),
    isOrgAllowlisted: (orgId, cap) => deps.tenantStore.isOrgAllowlisted(orgId, cap),
    isPropertyAllowlisted: (propertyId, cap) =>
      deps.tenantStore.isPropertyAllowlisted(propertyId, cap),
    isOrgSuspended: (orgId) => deps.tenantStore.isOrgSuspended(orgId),
    isPropertySuspended: (propertyId) => deps.tenantStore.isPropertySuspended(propertyId),
  }
}
