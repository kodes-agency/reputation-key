// Rolling invitation-fact privacy proof against real PostgreSQL + Redis.
// Synthetic PII is seeded in activity jobs and both live/dead-letter event
// envelopes, then removed in bounded restartable batches before verification.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Queue } from 'bullmq'
import { getEnv } from '#/shared/config/env'
import {
  createInvitationFactQueueAdapter,
  inspectIdentityInvitationFactContract,
  scrubIdentityInvitationFactContract,
  switchIdentityInvitationFactToV2,
  verifyIdentityInvitationFactContract,
  type InvitationFactContractDeps,
} from '#/shared/ops/identity-invitation-fact-contract'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

const DEFAULT_QUEUE = 'identity-invitation-fact-it-default'
const DOMAIN_QUEUE = 'identity-invitation-fact-it-domain'
const QUARANTINE_QUEUE = 'identity-invitation-fact-it-quarantine'
const FACT_ID = '87000000-0000-4000-8000-000000000001'
const ACTIVITY_ID = '87000000-0000-4000-8000-000000000002'
const SECRET = 'synthetic-secret@example.test'

let dbLease: TestLease
let redisLease: RedisTestLease | undefined
let redisAvailable = false
let defaultQueue: Queue | undefined
let domainQueue: Queue | undefined
let quarantineQueue: Queue | undefined

async function obliterateQuietly(queue: Queue | undefined): Promise<void> {
  if (!queue) return
  try {
    await queue.obliterate({ force: true })
  } catch {
    // Suite-unique queue may not have been materialized yet.
  }
}

function deps(): InvitationFactContractDeps {
  return {
    pool: dbLease.pool,
    defaultQueue: createInvitationFactQueueAdapter(defaultQueue!),
    domainEventsQueue: createInvitationFactQueueAdapter(domainQueue!),
    quarantineQueue: createInvitationFactQueueAdapter(quarantineQueue!),
  }
}

beforeAll(async () => {
  dbLease = await acquireTestLease(getEnv().DATABASE_URL)
  redisLease = await acquireRedisTestLease()
  redisAvailable = redisLease.available
  if (!redisAvailable || !redisLease.redis) return
  const connection = redisLease.redis as unknown as import('bullmq').ConnectionOptions
  defaultQueue = new Queue(DEFAULT_QUEUE, { connection })
  domainQueue = new Queue(DOMAIN_QUEUE, { connection })
  quarantineQueue = new Queue(QUARANTINE_QUEUE, { connection })
  await Promise.all([
    obliterateQuietly(defaultQueue),
    obliterateQuietly(domainQueue),
    obliterateQuietly(quarantineQueue),
  ])
})

afterAll(async () => {
  await dbLease.pool.query('DELETE FROM outbox_events WHERE id = $1', [FACT_ID])
  await dbLease.pool.query('DELETE FROM recent_activity_entries WHERE id = $1', [
    ACTIVITY_ID,
  ])
  await dbLease.pool.query(`
    UPDATE identity_invitation_fact_contract
    SET issuance_version = 1, generation = generation + 1,
        switched_at = NULL, verified_at = NULL,
        operator_id = NULL, reason = NULL, updated_at = now()
    WHERE singleton = true`)
  await Promise.all([
    obliterateQuietly(defaultQueue),
    obliterateQuietly(domainQueue),
    obliterateQuietly(quarantineQueue),
  ])
  await Promise.all([
    defaultQueue?.close(),
    domainQueue?.close(),
    quarantineQueue?.close(),
  ])
  redisLease?.release()
  await dbLease.release()
})

describe('identity invitation fact cutover against real retained stores', () => {
  it('scrubs PostgreSQL, live jobs, and quarantine in bounded resumable batches', async () => {
    if (!redisAvailable || !defaultQueue || !domainQueue || !quarantineQueue) return

    await dbLease.pool.query(`
      UPDATE identity_invitation_fact_contract
      SET issuance_version = 1, generation = generation + 1,
          switched_at = NULL, verified_at = NULL,
          operator_id = NULL, reason = NULL, updated_at = now()
      WHERE singleton = true`)
    await dbLease.pool.query(
      `INSERT INTO outbox_events (
         id, event_type, event_version, payload, organization_id,
         source_context, source_aggregate_id
       ) VALUES (
         $1, 'identity.member.invited', 1,
         '{"invitationId":"invitation-1","organizationId":"organization-1","role":"PropertyManager","email":"legacy@example.test"}'::jsonb,
         'organization-1', 'identity', 'invitation-1'
       )`,
      [FACT_ID],
    )
    await dbLease.pool.query(
      `INSERT INTO recent_activity_entries (
         id, actor_id, actor_name, actor_role, action, resource_type,
         resource_id, organization_id, payload, source
       ) VALUES (
         $1, 'actor-1', 'Account Admin', 'AccountAdmin', 'invited', 'member',
         'invitation-1', 'organization-1',
         jsonb_build_object('subject','member','from',NULL,'to','PropertyManager','detail',$2::text),
         'web'
       )`,
      [ACTIVITY_ID, SECRET],
    )

    const activityData = {
      action: 'invited',
      resourceType: 'member',
      resourceId: 'invitation-1',
      organizationId: 'organization-1',
      payload: { subject: 'member', detail: SECRET },
    }
    const eventData = {
      eventId: 'event-1',
      eventType: 'identity.member.invited',
      eventVersion: 1,
      payload: { invitationId: 'invitation-1', email: SECRET },
      organizationId: 'organization-1',
      propertyId: null,
      sourceContext: 'identity',
      sourceAggregateId: 'invitation-1',
    }
    await defaultQueue.add('project-recent-activity', activityData, {
      jobId: 'activity-live',
    })
    const liveEvent = await domainQueue.add('identity.member.invited', eventData, {
      jobId: 'event-live',
    })
    await domainQueue.add(
      'identity.member.invited',
      {
        invitationId: 'invitation-bare',
        organizationId: 'organization-1',
        role: 'PropertyManager',
        email: SECRET,
      },
      { jobId: 'event-bare-pre-bqr' },
    )
    const domainClient = await domainQueue.client
    await domainClient.hset(domainQueue.toKey(liveEvent.id!), {
      failedReason: `SyntheticFailure: ${SECRET}`,
      stacktrace: JSON.stringify([`Error: ${SECRET}`, `at synthetic (${SECRET}:1:1)`]),
    })
    await liveEvent.log(`processor retained ${SECRET}`)
    await quarantineQueue.add(
      'project-recent-activity',
      {
        originalQueue: 'default',
        originalJobId: 'activity-failed',
        jobName: 'project-recent-activity',
        data: activityData,
        failedReason: `SyntheticFailure: ${SECRET}`,
        attemptsMade: 3,
        quarantinedAt: '2026-08-26T00:00:00.000Z',
      },
      { jobId: 'activity-quarantined' },
    )
    await quarantineQueue.add(
      'identity.member.invited',
      {
        originalQueue: 'domain-events',
        originalJobId: 'event-failed',
        jobName: 'identity.member.invited',
        data: eventData,
        failedReason: `SyntheticFailure: ${SECRET}`,
        attemptsMade: 3,
        quarantinedAt: '2026-08-26T00:00:00.000Z',
      },
      { jobId: 'event-quarantined' },
    )
    await Promise.all([defaultQueue.pause(), domainQueue.pause()])

    await switchIdentityInvitationFactToV2(deps(), {
      operatorId: 'integration-test',
      reason: 'prove retained-store privacy cutover',
    })

    const batchTotals: number[] = []
    for (let attempt = 0; attempt < 10; attempt++) {
      const batch = await scrubIdentityInvitationFactContract(deps(), {
        batchSize: 2,
        apply: true,
      })
      batchTotals.push(batch.changedTotal)
      expect(batch.changedTotal).toBeLessThanOrEqual(2)
      if (batch.changedTotal === 0) break
    }
    expect(batchTotals.filter((count) => count > 0).length).toBeGreaterThan(1)
    expect(batchTotals.at(-1)).toBe(0)

    const inspection = await inspectIdentityInvitationFactContract(deps())
    expect(inspection.totalDirty).toBe(0)
    expect(inspection.privacyDirty).toBe(0)

    // A relay that claimed a v1 row before the switch can publish its
    // content-free sentinel after the scrub scan. That is compatibility work
    // for the later contraction, not a privacy regression, so sealing remains
    // race-safe without claiming that every v1 envelope has disappeared.
    await domainQueue.add(
      'identity.member.invited',
      {
        ...eventData,
        eventId: 'event-late-v1-sentinel',
        payload: { invitationId: 'invitation-1', email: '[redacted]' },
      },
      { jobId: 'event-late-v1-sentinel' },
    )
    const lateCompatibility = await inspectIdentityInvitationFactContract(deps())
    expect(lateCompatibility).toMatchObject({
      totalDirty: 1,
      privacyDirty: 0,
      compatibilityV1: 2,
    })
    const verified = await verifyIdentityInvitationFactContract(deps(), {
      operatorId: 'integration-test',
      reason: 'synthetic markers absent from every retained store',
    })
    expect(verified.verifiedAt).toBeInstanceOf(Date)

    const fact = await dbLease.pool.query<{
      event_version: number
      payload: Record<string, unknown>
    }>('SELECT event_version, payload FROM outbox_events WHERE id = $1', [FACT_ID])
    const activity = await dbLease.pool.query<{ payload: Record<string, unknown> }>(
      'SELECT payload FROM recent_activity_entries WHERE id = $1',
      [ACTIVITY_ID],
    )
    expect(fact.rows[0]!.event_version).toBe(2)
    expect(fact.rows[0]!.payload).not.toHaveProperty('email')
    expect(activity.rows[0]!.payload).toMatchObject({ detail: null })

    const retainedJobs = await Promise.all([
      defaultQueue.getJobs(['waiting', 'paused']),
      domainQueue.getJobs(['waiting', 'paused']),
      quarantineQueue.getJobs(['waiting', 'paused']),
    ])
    const retainedLogs = await domainQueue.getJobLogs('event-live')
    expect(
      JSON.stringify([fact.rows, activity.rows, retainedJobs, retainedLogs]),
    ).not.toContain(SECRET)
    expect(JSON.stringify(retainedJobs)).not.toContain('legacy@example.test')
  })
})
