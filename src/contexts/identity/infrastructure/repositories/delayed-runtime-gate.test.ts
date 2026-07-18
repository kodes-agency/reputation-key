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
//       flows into the decision and the audit row records the named system
//       principal + correlation.
//
// Setup pattern mirrors delayed-policy-init.test.ts (BQC-2.5 wiring proof).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import type { CapabilityPolicyEnv } from '#/shared/auth/beta-capabilities'
import { resetCapabilityPolicyStore } from '#/shared/auth/beta-capabilities'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import { gateJob } from '#/shared/jobs/delayed-execution-gate'
import { initPersistedCapabilityPolicyStore } from '../policy-store-init'
import { setOrganizationPolicy } from './policy-state.repository'

const db = getDb()
const ORG = 'org-delayed-gate'
const PROP = 'd4000000-0000-4000-8000-000000000088'
const CONN = 'd4000000-0000-4000-8000-000000000099'

const SYNC_DATA = {
  propertyId: PROP,
  organizationId: ORG,
  connectionId: CONN,
  locationName: 'accounts/111/locations/222',
}

beforeAll(async () => {
  await db.execute(sql`DELETE FROM policy_decision_audit WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization_policy WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Delayed Gate Org', ${ORG}, now())`,
  )
  resetCapabilityPolicyStore()
  resetDelayedExecutionPolicy()
  initPersistedCapabilityPolicyStore({ db, env: {} as CapabilityPolicyEnv })
})

afterAll(async () => {
  resetDelayedExecutionPolicy()
  resetCapabilityPolicyStore()
  await db.execute(sql`DELETE FROM policy_decision_audit WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization_policy WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
})

async function auditRowsFor(
  correlationId: string,
): Promise<Array<Record<string, unknown>>> {
  let rows: Array<Record<string, unknown>> = []
  for (let i = 0; i < 20 && rows.length === 0; i++) {
    const result = await db.execute(
      sql`SELECT actor_type, actor_id, action, execution_kind, decision, reason, correlation_id
          FROM policy_decision_audit WHERE correlation_id = ${correlationId}`,
    )
    rows = result.rows as Array<Record<string, unknown>>
    if (rows.length > 0) break
    await new Promise((r) => setTimeout(r, 50))
  }
  return rows
}

describe('delayed runtime gate (BQC-3.2, real PG)', () => {
  it('(a) revocation-while-queued: allow at enqueue, deny_terminal at dispatch after suspension', async () => {
    // The job "queued" while policy allowed (the allow decision here proves
    // the pre-mutation posture — the queued envelope itself carries no
    // decision, only content-free context).
    const before = await gateJob(
      'sync-property-reviews',
      SYNC_DATA,
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
      'sync-property-reviews',
      SYNC_DATA,
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
      'sync-property-reviews',
      SYNC_DATA,
      'worker:default',
      'worker',
    )

    expect(outcome.kind).toBe('deny_retry')
    expect(outcome.decision.reason).toBe('policy_unavailable')
    expect(outcome.decision.allowed).toBe(false)

    // Restore the composition-installed persisted policy for later tests.
    initPersistedCapabilityPolicyStore({ db, env: {} as CapabilityPolicyEnv })
  })

  it('(c) manual-enqueue initiator: stamped envelope decides; audit records principal + correlation', async () => {
    const outcome = await gateJob(
      'publish-reply',
      {
        replyId: 'd4000000-0000-4000-8000-0000000000aa',
        organizationId: ORG,
        propertyId: PROP,
        policy: {
          initiator: { kind: 'user', id: 'user-manual-1' },
          correlationId: 'corr-manual-enqueue-1',
        },
      },
      'worker:default',
      'worker',
    )

    expect(outcome.kind).toBe('allow')

    const rows = await auditRowsFor('corr-manual-enqueue-1')
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0]).toMatchObject({
      actor_type: 'system',
      actor_id: 'worker:default',
      action: 'system:reply.publish',
      execution_kind: 'worker',
      decision: 'allow',
      correlation_id: 'corr-manual-enqueue-1',
    })
    // Content-free: no reply text or reviewer identity in the audit row.
    expect(Object.keys(rows[0]).sort()).toEqual([
      'action',
      'actor_id',
      'actor_type',
      'correlation_id',
      'decision',
      'execution_kind',
      'reason',
    ])
  })
})
