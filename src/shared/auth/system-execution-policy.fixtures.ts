// BQC-2.5 — delayed/system policy contract fixtures.
//
// Deterministic contract cases for workers/consumers/schedules to adopt
// (phase BQC-2 §2.5). BQC-3 imports these same fixtures for its integration
// tests — the contract is shared, not duplicated (execution ownership model:
// BQC-2 IMPLEMENTS the contract, BQC-3 INTEGRATES it).
//
// Each fixture is self-contained: the capability-store env to install, the
// normalized delayed decision request, and the expected outcome.

import type { CapabilityPolicyEnv } from './beta-capabilities'
import type { DelayedDecisionRequest } from './system-execution-policy'

export type DelayedContractFixture = Readonly<{
  name: string
  /** Capability-store env to install before deciding (empty = default posture). */
  env: CapabilityPolicyEnv
  request: Omit<DelayedDecisionRequest, 'now'>
  expect: Readonly<{
    allowed: boolean
    reason?: string
  }>
}>

const BASE = {
  organizationId: 'org-fixture',
  executionKind: 'worker' as const,
}

export const DELAYED_CONTRACT_FIXTURES: ReadonlyArray<DelayedContractFixture> = [
  {
    name: 'current allow — review sync with GBP capability',
    env: {},
    request: {
      ...BASE,
      principal: { kind: 'system', id: 'worker:default' },
      action: 'system:review.sync',
      propertyId: 'd4000000-0000-4000-8000-000000000051',
    },
    expect: { allowed: true, reason: 'allowed' },
  },
  {
    name: 'deny — org suspended stops pending work with a typed state',
    env: { BETA_SUSPENDED_ORGS: 'org-fixture' },
    request: {
      ...BASE,
      principal: { kind: 'system', id: 'worker:default' },
      action: 'system:review.sync',
      propertyId: 'd4000000-0000-4000-8000-000000000051',
    },
    expect: { allowed: false, reason: 'org_suspended' },
  },
  {
    name: 'deny — Google switched off after enqueue (stale allow never overrides)',
    env: { BETA_CAPABILITIES_OFF: 'google' },
    request: {
      ...BASE,
      principal: { kind: 'system', id: 'worker:default' },
      action: 'system:review.sync',
      propertyId: 'd4000000-0000-4000-8000-000000000051',
    },
    expect: { allowed: false, reason: 'capability_disabled' },
  },
  {
    name: 'deny — optional email is switched off',
    env: { BETA_CAPABILITIES_OFF: 'optional_email' },
    request: {
      ...BASE,
      principal: { kind: 'system', id: 'schedule:digest' },
      action: 'system:notification.email_digest',
      organizationId: 'org-fixture',
      executionKind: 'schedule',
    },
    expect: { allowed: false, reason: 'capability_disabled' },
  },
  {
    name: 'deny — missing scope (property-scoped action without propertyId)',
    env: {},
    request: {
      ...BASE,
      principal: { kind: 'system', id: 'worker:default' },
      action: 'system:review.sync',
    },
    expect: { allowed: false, reason: 'missing_scope' },
  },
  {
    name: 'allow — tenant-cross reconciliation needs no property scope',
    env: {},
    request: {
      ...BASE,
      principal: { kind: 'system', id: 'schedule:review-reconciliation' },
      action: 'system:review.reconcile',
      executionKind: 'schedule',
    },
    expect: { allowed: true, reason: 'allowed' },
  },
  {
    name: 'deny — consumer with missing scope (inbox update without org)',
    env: {},
    request: {
      principal: { kind: 'system', id: 'consumer:inbox' },
      action: 'system:inbox.update',
      organizationId: '',
      executionKind: 'consumer',
    },
    expect: { allowed: false, reason: 'missing_scope' },
  },
]
