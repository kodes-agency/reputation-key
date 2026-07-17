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
    outcome: 'allow' | 'deny' | 'stale_context'
    reason?: string
    /** Whether the action's external effect requires the strong policy read. */
    freshRead: boolean
  }>
}>

const BASE = {
  organizationId: 'org-fixture',
  executionKind: 'worker' as const,
}

export const DELAYED_CONTRACT_FIXTURES: ReadonlyArray<DelayedContractFixture> = [
  {
    name: 'current allow — review sync with GBP capability and fresh read',
    env: {},
    request: {
      ...BASE,
      principal: { kind: 'system', id: 'worker:default' },
      action: 'system:review.sync',
      propertyId: 'd4000000-0000-4000-8000-000000000051',
      policyVersionAtEnqueue: 'bqc-2.4',
    },
    expect: { outcome: 'allow', reason: 'allowed', freshRead: true },
  },
  {
    name: 'deny — org suspended stops pending work with a typed state',
    env: { BETA_SUSPENDED_ORGS: 'org-fixture' },
    request: {
      ...BASE,
      principal: { kind: 'system', id: 'worker:default' },
      action: 'system:review.sync',
      propertyId: 'd4000000-0000-4000-8000-000000000051',
      policyVersionAtEnqueue: 'bqc-2.4',
    },
    expect: { outcome: 'deny', reason: 'org_suspended', freshRead: true },
  },
  {
    name: 'deny — capability killed after enqueue (stale allow never overrides)',
    env: { BETA_CAPABILITIES_OFF: 'property.connect_gbp' },
    request: {
      ...BASE,
      principal: { kind: 'system', id: 'worker:default' },
      action: 'system:review.sync',
      propertyId: 'd4000000-0000-4000-8000-000000000051',
      policyVersionAtEnqueue: 'bqc-2.4',
    },
    expect: { outcome: 'deny', reason: 'capability_disabled', freshRead: true },
  },
  {
    name: 'deny — blocked capability (email) never executes',
    env: {},
    request: {
      ...BASE,
      principal: { kind: 'system', id: 'schedule:digest' },
      action: 'system:notification.email_digest',
      organizationId: 'org-fixture',
      executionKind: 'schedule',
      policyVersionAtEnqueue: 'bqc-2.4',
    },
    expect: { outcome: 'deny', reason: 'capability_blocked', freshRead: true },
  },
  {
    name: 'deny — consent required and missing',
    env: {},
    request: {
      ...BASE,
      principal: { kind: 'system', id: 'worker:default' },
      action: 'system:review.sync',
      propertyId: 'd4000000-0000-4000-8000-000000000051',
      purpose: 'ai.analyze',
      policyVersionAtEnqueue: 'bqc-2.4',
    },
    expect: { outcome: 'deny', reason: 'consent_required', freshRead: true },
  },
  {
    name: 'deny — missing scope (property-scoped action without propertyId)',
    env: {},
    request: {
      ...BASE,
      principal: { kind: 'system', id: 'worker:default' },
      action: 'system:review.sync',
      policyVersionAtEnqueue: 'bqc-2.4',
    },
    expect: { outcome: 'deny', reason: 'missing_scope', freshRead: true },
  },
  {
    name: 'allow — tenant-cross rollup needs no property scope and no fresh read',
    env: {},
    request: {
      ...BASE,
      principal: { kind: 'system', id: 'schedule:metrics' },
      action: 'system:metric.refresh',
      executionKind: 'schedule',
      policyVersionAtEnqueue: 'bqc-2.4',
    },
    expect: { outcome: 'allow', reason: 'allowed', freshRead: false },
  },
  {
    name: 'stale_context — envelope policy version differs; fresh decision stands',
    env: {},
    request: {
      ...BASE,
      principal: { kind: 'system', id: 'worker:default' },
      action: 'system:reply.publish',
      propertyId: 'd4000000-0000-4000-8000-000000000051',
      policyVersionAtEnqueue: 'bqc-0.3',
    },
    expect: { outcome: 'stale_context', reason: 'allowed', freshRead: true },
  },
  {
    name: 'deny — consumer with missing scope (inbox update without org)',
    env: {},
    request: {
      principal: { kind: 'system', id: 'consumer:inbox' },
      action: 'system:inbox.update',
      organizationId: '',
      executionKind: 'consumer',
      policyVersionAtEnqueue: 'bqc-2.4',
    },
    expect: { outcome: 'deny', reason: 'missing_scope', freshRead: false },
  },
]
