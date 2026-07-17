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
  getPolicyVersion,
  loadPolicySnapshot,
} from './repositories/policy-state.repository'

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
