// Delayed runtime gate integration tests against process-static policy.
//
// A refresh failure remains retryable and a manual-enqueue principal produces
// content-free decision evidence. Static policy eliminates the mutable
// suspension snapshot and its dispatch-time database refresh.

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
import { initCapabilityPolicyStore } from '../policy-store-init'

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

  await deleteTestOrganizations(db, [ORG])
  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Delayed Gate Org', ${ORG}, now())`,
  )
  resetCapabilityPolicyStore()
  resetDelayedExecutionPolicy()
  // ARC-03-T8: the handle no longer installs itself — the dispatch gate reads
  // the process-bound delayed policy, so bind explicitly.
  bindProcessPolicies(
    initCapabilityPolicyStore({
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

  await deleteTestOrganizations(db, [ORG])
})


describe('delayed runtime gate (BQC-3.2, real PG)', () => {

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

    // Restore the process-bound static policy for later tests.
    releaseProcessPolicies()
    bindProcessPolicies(
      initCapabilityPolicyStore({
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
