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
import type { CapabilityPolicyEnv } from '#/shared/auth/beta-capabilities'
import { getLogger } from '#/shared/observability/logger'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import {
  createCompositePolicyStore,
  createPersistedPolicyStore,
  snapshotFromEnv,
  type PersistedPolicyStore,
} from '#/shared/auth/persisted-policy-store'
import {
  createExecutionPolicy,
  initExecutionPolicy,
} from '#/shared/auth/execution-policy'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import { organizationId, userId } from '#/shared/domain/ids'
import {
  getPolicyVersion,
  loadPolicySnapshot,
} from './repositories/policy-state.repository'
import { createGrantAccessLookup } from './adapters/grant-access-lookup.adapter'
import { getActiveConsent } from './repositories/policy-consent.repository'
import { writePolicyDecision } from './repositories/policy-decision-audit.repository'

/** Revocation/suspension bound: tenant policy state is at most this stale. */
export const POLICY_REFRESH_INTERVAL_MS = 5_000

export type PolicyStoreHandle = Readonly<{
  /** Version-gated strong read — await before decisions that must be fresh. */
  refresh: PersistedPolicyStore['refresh']
  /** Current DB policy version (null when only the env seed is present). */
  currentVersion: PersistedPolicyStore['currentVersion']
  /** Stop the background poller (shutdown/tests). */
  stopPolling: () => void
}>

export function initPersistedCapabilityPolicyStore(deps: {
  db: Database
  env: CapabilityPolicyEnv
}): PolicyStoreHandle {
  const logger = getLogger()
  const envStore = createEnvCapabilityPolicyStore(deps.env)
  const persisted = createPersistedPolicyStore({
    loadSnapshot: () => loadPolicySnapshot(deps.db),
    loadVersion: () => getPolicyVersion(deps.db),
    initialSnapshot: snapshotFromEnv(deps.env),
    onRefreshError: (err) =>
      logger.warn({ err }, 'policy snapshot refresh failed — keeping previous snapshot'),
  })
  initCapabilityPolicyStore(
    createCompositePolicyStore({ globalStore: envStore, tenantStore: persisted }),
  )

  // BQC-2.4: install the ExecutionPolicy with identity-owned deps — the grant
  // adapter (property scope), the consent reader (purpose classes), and the
  // content-free decision-audit writer. Decisions consult the capability
  // store installed above, so tenant state stays consistent across both.
  const grantLookup = createGrantAccessLookup(deps.db)
  initExecutionPolicy(
    createExecutionPolicy({
      listAccessiblePropertyIds: async (orgId, uid) => {
        const ids = await grantLookup(organizationId(orgId), userId(uid))
        return ids.map((id) => id as string)
      },
      hasActiveConsent: async (input) => {
        const consent = await getActiveConsent(deps.db, input)
        return consent !== null
      },
      writeDecisionAudit: (entry) => writePolicyDecision(deps.db, entry),
      onAuditError: (err) => logger.warn({ err }, 'policy decision audit write failed'),
    }),
  )

  // BQC-2.5: install the delayed/system policy contract — the strong read
  // for external-effect actions is the same version-gated refresh (worker
  // call-site integration is BQC-3's).
  initDelayedExecutionPolicy(
    createDelayedExecutionPolicy({
      refreshPolicy: () => persisted.refresh(),
      hasActiveConsent: async (input) => {
        const consent = await getActiveConsent(deps.db, input)
        return consent !== null
      },
      writeDecisionAudit: (entry) => writePolicyDecision(deps.db, entry),
      onAuditError: (err) => logger.warn({ err }, 'delayed decision audit write failed'),
    }),
  )

  // Fire-and-forget first refresh: the env seed covers the bootstrap window
  // (union semantics), DB truth lands within one refresh.
  const stopPolling = persisted.startPolling(POLICY_REFRESH_INTERVAL_MS)
  void persisted.refresh()

  return {
    refresh: () => persisted.refresh(),
    currentVersion: () => persisted.currentVersion(),
    stopPolling,
  }
}
