// BQC-3.2 — delayed runtime gate integration tests (real PostgreSQL).
//
// Proves the dispatch gate against the composition-installed persisted policy:
//   (a) revocation-while-queued — an allow at enqueue time is re-decided at
//       dispatch; a suspension written after enqueue denies NOW (strong read),
//       with a terminal typed outcome;
//   (b) unavailable policy — a strong-read failure maps to deny_retry so the
//       worker throws and BullMQ retries (protected work never runs without a
//       decision);
//   (c) manual-enqueue initiator — a stamped content-free policy envelope
//       flows into the returned decision.
//
// Setup pattern mirrors delayed-policy-init.test.ts (BQC-2.5 wiring proof).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { CapabilityPolicyEnv } from '#/shared/auth/beta-capabilities'
import { resetCapabilityPolicyStore } from '#/shared/auth/beta-capabilities'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import { gateJob } from '#/shared/jobs/delayed-execution-gate'
import { EXECUTION_POLICY_VERSION } from '#/shared/auth/execution-policy'
import {
  bindProcessPolicies,
  releaseProcessPolicies,
} from '#/shared/auth/process-policy-binding'
import { initPersistedCapabilityPolicyStore } from '../policy-store-init'
import { setOrganizationPolicy } from './policy-state.repository'

const db = getDb()
const ORG = 'org-delayed-gate'
const POLICY_ENV = {
  NODE_ENV: 'test',
  BETA_E2E_GLOBAL_CAPABILITIES: 'notification.send_email',
} satisfies CapabilityPolicyEnv
const EMAIL_DATA = {
  organizationId: ORG,
  capability: 'notification.send_email' as const,
}

beforeAll(async () => {
  await db.execute(sql`DELETE FROM organization_policy WHERE organization_id = ${ORG}`)
  await deleteTestOrganizations(db, [ORG])
  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Delayed Gate Org', ${ORG}, now())`,
  )
  resetCapabilityPolicyStore()
  resetDelayedExecutionPolicy()
  // ARC-03-T8: the handle no longer installs itself — the dispatch gate reads
  // the process-bound delayed policy, so bind explicitly.
  bindProcessPolicies(
    initPersistedCapabilityPolicyStore({
      db,
      env: POLICY_ENV,
      clock: () => new Date(),
      logger: { warn: () => {} },
    }),
  )
})

afterAll(async () => {
  releaseProcessPolicies()
  resetDelayedExecutionPolicy()
  resetCapabilityPolicyStore()
  await db.execute(sql`DELETE FROM organization_policy WHERE organization_id = ${ORG}`)
  await deleteTestOrganizations(db, [ORG])
})


describe('delayed runtime gate (BQC-3.2, real PG)', () => {
  it('(a) revocation-while-queued: allow at enqueue, deny_terminal at dispatch after suspension', async () => {
    // The job "queued" while policy allowed (the allow decision here proves
    // the pre-mutation posture — the queued envelope itself carries no
    // decision, only content-free context).
    const before = await gateJob(
      'digest-notification',
      EMAIL_DATA,
      'worker:default',
      'worker',
    )
    expect(before.kind).toBe('allow')
    expect(before.decision.freshRead).toBe(true)

    // Operator suspends the org while the job sits in the queue.
    await setOrganizationPolicy(db, { organizationId: ORG, suspendedAt: new Date() })

    // Dispatch-time re-authorization sees the CURRENT policy and denies with
    // a typed terminal outcome — the stale allow never executes.
    const after = await gateJob(
      'digest-notification',
      EMAIL_DATA,
      'worker:default',
      'worker',
    )
    expect(after.kind).toBe('deny_terminal')
    expect(after.decision.allowed).toBe(false)
    expect(after.decision.reason).toBe('org_suspended')

    // Restore for later tests.
    await setOrganizationPolicy(db, { organizationId: ORG, suspendedAt: null })
  })

  it('(b) unavailable policy: strong-read failure maps to deny_retry', async () => {
    initDelayedExecutionPolicy(
      createDelayedExecutionPolicy({
        refreshPolicy: async () => {
          throw new Error('policy store down')
        },
      }),
    )

    const outcome = await gateJob(
      'digest-notification',
      EMAIL_DATA,
      'worker:default',
      'worker',
    )

    expect(outcome.kind).toBe('deny_retry')
    expect(outcome.decision.reason).toBe('policy_unavailable')
    expect(outcome.decision.allowed).toBe(false)

    // Restore the process-bound persisted policy for later tests.
    releaseProcessPolicies()
    bindProcessPolicies(
      initPersistedCapabilityPolicyStore({
        db,
        env: POLICY_ENV,
        clock: () => new Date(),
        logger: { warn: () => {} },
      }),
    )
  })

  it('(c) manual-enqueue initiator: stamped envelope returns its decision', async () => {
    const outcome = await gateJob(
      'digest-notification',
      {
        organizationId: ORG,
        capability: 'notification.send_email',
        initiator: { kind: 'user', id: 'user-manual-1' },
        correlationId: 'corr-manual-enqueue-1',
        policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
      },
      'worker:default',
      'worker',
    )

    expect(outcome.kind).toBe('allow')
    expect(outcome.decision).toMatchObject({
      allowed: true,
      reason: 'allowed',
      action: 'system:notification.email_digest',
      policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
    })
  })
})
