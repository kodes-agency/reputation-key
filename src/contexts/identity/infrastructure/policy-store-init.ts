// BQC-2.2 — persisted capability-policy initialization (composition seam).
//
// Installs the composite CapabilityPolicyStore: env store for global posture
// (core sets, kill switch, e2e overrides — BQC-0.3/0.4 semantics unchanged),
// persisted snapshot store for tenant state (org/property allowlist +
// suspension from the 0014 policy tables). The env allowlist/suspension seed
// unions in permanently, so installing this changes nothing until DB rows
// exist (ADR 0047).
//
// Refresh model: version-gated (policy_version) — a refresh is one cheap row
// read; the snapshot reloads only when the version moved. Revocation and
// suspension therefore take effect within POLICY_REFRESH_INTERVAL_MS — the
// measured bound required by phase BQC-2 §2.2. The worker additionally awaits
// one refresh before starting (container.refreshPolicyStore) so its first
// decisions already see DB truth; protected external side effects get a
// fresh/strong read via the same function (BQC-2.5).

import type { Database } from '#/shared/db'
import type {
  CapabilityPolicyEnv,
  CapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { createEnvCapabilityPolicyStore } from '#/shared/auth/beta-capabilities'
import {
  createCompositePolicyStore,
  createPersistedPolicyStore,
  snapshotFromEnv,
  type PersistedPolicyStore,
} from '#/shared/auth/persisted-policy-store'
import {
  createExecutionPolicy,
  parseOperatorIdentities,
  type ExecutionPolicy,
  type MerchantAiConsentFence,
} from '#/shared/auth/execution-policy'
import {
  createDelayedExecutionPolicy,
  type DelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import { organizationId, userId } from '#/shared/domain/ids'
import {
  getPolicyControlVersion,
  loadPolicySnapshot,
} from './repositories/policy-state.repository'
import { createGrantAccessLookup } from './adapters/grant-access-lookup.adapter'
import { getActiveConsent } from './repositories/policy-consent.repository'
import { hasActiveMerchantAiConsent } from './repositories/merchant-ai-authorization.repository'

const MERCHANT_AI_PURPOSES = new Set([
  'ai.analyze',
  'ai.generate_reply',
  'ai.detect_trends',
])

/**
 * Revocation/suspension bound: tenant policy state is at most this stale.
 * Exported so the container-shutdown evidence (ARC-03-T6) advances timers
 * against the real interval instead of a copy that could silently drift.
 */
export const POLICY_REFRESH_INTERVAL_MS = 5_000

export type PolicyStoreHandle = Readonly<{
  /**
   * ARC-03-T8: the trio is RETURNED, never installed here. Making the process
   * installation a separate, named step (shared/auth/process-policy-binding)
   * stops a second container in the same process from silently re-pointing the
   * singletons at its own policy state and consent reader.
   */
  capabilityPolicyStore: CapabilityPolicyStore
  executionPolicy: ExecutionPolicy
  delayedExecutionPolicy: DelayedExecutionPolicy
  /** Version-gated strong read — await before decisions that must be fresh. */
  refresh: PersistedPolicyStore['refresh']
  /** Required refresh for provider calls and external effects; cache never authorizes failure. */
  refreshRequired: PersistedPolicyStore['refreshRequired']
  currentEmergencyKillVersion: PersistedPolicyStore['currentEmergencyKillVersion']
  /** Current DB policy version (null when only the env seed is present). */
  currentVersion: PersistedPolicyStore['currentVersion']
  /** Stop the background poller (shutdown/tests). */
  stopPolling: () => void
}>

export type PolicyStoreLogger = Readonly<{
  warn(fields: Readonly<Record<string, unknown>>, message: string): void
}>

export function initPersistedCapabilityPolicyStore(deps: {
  db: Database
  env: CapabilityPolicyEnv
  clock: () => Date
  logger: PolicyStoreLogger
}): PolicyStoreHandle {
  const envStore = createEnvCapabilityPolicyStore(deps.env)
  const persisted = createPersistedPolicyStore({
    loadSnapshot: () => loadPolicySnapshot(deps.db),
    loadControlVersion: () => getPolicyControlVersion(deps.db),
    initialSnapshot: snapshotFromEnv(deps.env),
    onRefreshError: (err) =>
      deps.logger.warn(
        { err },
        'policy snapshot refresh failed — keeping previous snapshot',
      ),
  })
  const capabilityPolicyStore: CapabilityPolicyStore = Object.freeze(
    createCompositePolicyStore({ globalStore: envStore, tenantStore: persisted }),
  )

  // BQC-2.4: build the ExecutionPolicy with identity-owned dependencies —
  // the grant adapter (property scope) and consent reader (purpose classes).
  // Binding this handle's trio together (ARC-03-T8) keeps tenant state
  // consistent across interactive and delayed decisions.
  // BQC-7.5: the operator branch's named-operator allowlist binds from
  // OPS_OPERATOR_IDENTITIES (absent/empty = every operator command denies).
  const grantLookup = createGrantAccessLookup(deps.db, deps.clock)
  const operatorIdentities = parseOperatorIdentities(deps.env)
  const hasActiveConsent = async (input: {
    organizationId: string
    subjectType: 'organization' | 'property' | 'user'
    subjectId: string
    purpose: string
    expectedFence?: MerchantAiConsentFence
    at: Date
  }): Promise<boolean> => {
    if (MERCHANT_AI_PURPOSES.has(input.purpose)) {
      if (input.subjectType !== 'property') return false
      return hasActiveMerchantAiConsent(deps.db, {
        organizationId: input.organizationId,
        propertyId: input.subjectId,
        purpose: input.purpose,
        expectedFence: input.expectedFence,
      })
    }
    const consent = await getActiveConsent(deps.db, input)
    return consent !== null
  }
  const executionPolicy: ExecutionPolicy = Object.freeze(
    createExecutionPolicy({
      listAccessiblePropertyIds: async (orgId, uid) => {
        const ids = await grantLookup(organizationId(orgId), userId(uid))
        return ids.map((id) => id as string)
      },
      hasActiveConsent,
      isRegisteredOperator: (id) => operatorIdentities.has(id),
    }),
  )

  // BQC-2.5: the delayed/system policy contract — the strong read for
  // external-effect actions is the same version-gated refresh (worker
  // call-site integration is BQC-3's).
  const delayedExecutionPolicy: DelayedExecutionPolicy = Object.freeze(
    createDelayedExecutionPolicy({
      refreshPolicy: () => persisted.refresh(),
      hasActiveConsent,
    }),
  )

  // Fire-and-forget first refresh: the env seed covers the bootstrap window
  // (union semantics), DB truth lands within one refresh.
  const stopPolling = persisted.startPolling(POLICY_REFRESH_INTERVAL_MS)
  void persisted.refresh()

  return {
    capabilityPolicyStore,
    executionPolicy,
    delayedExecutionPolicy,
    refresh: () => persisted.refresh(),
    refreshRequired: () => persisted.refreshRequired(),
    currentEmergencyKillVersion: () => persisted.currentEmergencyKillVersion(),
    currentVersion: () => persisted.currentVersion(),
    stopPolling,
  }
}
