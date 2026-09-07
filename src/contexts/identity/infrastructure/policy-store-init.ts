// Identity composition seam for the static capability policy.
//
// Capability fate and environment controls are immutable for the process
// lifetime. Tenant-specific authorization remains live through grant and
// consent repositories; no database policy snapshot or background poller is
// involved.

import type { Database } from '#/shared/db'
import type {
  CapabilityPolicyEnv,
  CapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { createEnvCapabilityPolicyStore } from '#/shared/auth/beta-capabilities'
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
import { createGrantAccessLookup } from './adapters/grant-access-lookup.adapter'
import { getActiveConsent } from './repositories/policy-consent.repository'
import { hasActiveMerchantAiConsent } from './repositories/merchant-ai-authorization.repository'

const MERCHANT_AI_PURPOSES: Readonly<Record<string, true>> = Object.freeze({
  'ai.analyze': true,
  'ai.generate_reply': true,
  'ai.detect_trends': true,
})

/** Stable revision of the TypeScript capability configuration. */
const STATIC_CAPABILITY_POLICY_VERSION = 1

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
  /**
   * Compatibility with the composition boot contract. Static policy is
   * already current, so awaiting this is an immediate successful observation.
   */
  refresh: () => Promise<void>
  refreshRequired: () => Promise<void>
  currentVersion: () => number
}>

export type PolicyStoreLogger = Readonly<{
  warn(fields: Readonly<Record<string, unknown>>, message: string): void
}>

export function buildCapabilityPolicyHandle(deps: {
  db: Database
  env: CapabilityPolicyEnv
  clock: () => Date
  logger: PolicyStoreLogger
}): PolicyStoreHandle {
  const capabilityPolicyStore = Object.freeze(createEnvCapabilityPolicyStore(deps.env))

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
    if (MERCHANT_AI_PURPOSES[input.purpose]) {
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

  const executionPolicy = Object.freeze(
    createExecutionPolicy({
      listAccessiblePropertyIds: async (orgId, uid) => {
        const ids = await grantLookup(organizationId(orgId), userId(uid))
        return ids.map((id) => id as string)
      },
      hasActiveConsent,
      isRegisteredOperator: (id) => operatorIdentities.has(id),
    }),
  )

  const observeStaticPolicy = async (): Promise<void> => {}
  const delayedExecutionPolicy = Object.freeze(
    createDelayedExecutionPolicy({
      refreshPolicy: observeStaticPolicy,
      hasActiveConsent,
    }),
  )

  return {
    capabilityPolicyStore,
    executionPolicy,
    delayedExecutionPolicy,
    refresh: observeStaticPolicy,
    refreshRequired: observeStaticPolicy,
    currentVersion: () => STATIC_CAPABILITY_POLICY_VERSION,
  }
}
