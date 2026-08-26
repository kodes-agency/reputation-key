import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  redactIdentityInvitationJobData,
  scrubIdentityInvitationFactContract,
  type InvitationFactQueue,
} from './identity-invitation-fact-contract'

const SECRET = 'synthetic-secret@example.test'

describe('identity invitation retained-job redaction', () => {
  it('redacts the exact activity job without changing its identifiers', () => {
    const data = {
      action: 'invited',
      resourceType: 'member',
      resourceId: 'invitation-1',
      organizationId: 'org-1',
      payload: { subject: 'member', from: null, to: 'PropertyManager', detail: SECRET },
    }
    const clean = redactIdentityInvitationJobData('default', 'insert-activity-log', data)
    expect(clean).toMatchObject({
      resourceId: 'invitation-1',
      organizationId: 'org-1',
      payload: { detail: null },
    })
    expect(JSON.stringify(clean)).not.toContain(SECRET)
  })

  it('promotes a retained domain envelope to clean v2', () => {
    const data = {
      eventId: 'event-1',
      eventType: 'identity.member.invited',
      eventVersion: 1,
      payload: { invitationId: 'invitation-1', email: SECRET },
    }
    const clean = redactIdentityInvitationJobData(
      'domain-events',
      'identity.member.invited',
      data,
    )
    expect(clean).toMatchObject({ eventId: 'event-1', eventVersion: 2 })
    expect((clean as { payload: Record<string, unknown> }).payload).not.toHaveProperty(
      'email',
    )
  })

  it('redacts the pre-BQR bare invitation payload shape', () => {
    const data = {
      invitationId: 'invitation-bare',
      organizationId: 'org-1',
      role: 'PropertyManager',
      email: SECRET,
    }
    const clean = redactIdentityInvitationJobData(
      'domain-events',
      'identity.member.invited',
      data,
    ) as Record<string, unknown>

    expect(clean).toMatchObject({
      invitationId: 'invitation-bare',
      organizationId: 'org-1',
    })
    expect(clean).not.toHaveProperty('email')
    expect(JSON.stringify(clean)).not.toContain(SECRET)
  })

  it('redacts both retained shapes inside quarantine envelopes', () => {
    const activity = redactIdentityInvitationJobData(
      'quarantine',
      'insert-activity-log',
      {
        originalQueue: 'default',
        failedReason: `SyntheticFailure: ${SECRET}`,
        data: {
          action: 'invited',
          resourceType: 'member',
          payload: { detail: SECRET },
        },
      },
    )
    const event = redactIdentityInvitationJobData(
      'quarantine',
      'identity.member.invited',
      {
        originalQueue: 'domain-events',
        failedReason: `SyntheticFailure: ${SECRET}`,
        data: {
          eventType: 'identity.member.invited',
          eventVersion: 1,
          payload: { email: SECRET },
        },
      },
    )
    const bare = redactIdentityInvitationJobData(
      'quarantine',
      'identity.member.invited',
      {
        originalQueue: 'domain-events',
        failedReason: `SyntheticFailure: ${SECRET}`,
        data: { invitationId: 'invitation-bare', email: SECRET },
      },
    )
    expect(JSON.stringify([activity, event, bare])).not.toContain(SECRET)
    expect(activity).toMatchObject({ failedReason: 'SyntheticFailure: [redacted]' })
    expect(event).toMatchObject({ failedReason: 'SyntheticFailure: [redacted]' })
    expect(event).toMatchObject({ data: { eventVersion: 2 } })
    expect(bare).toMatchObject({
      failedReason: 'SyntheticFailure: [redacted]',
      data: { invitationId: 'invitation-bare' },
    })
  })

  it('leaves unrelated jobs byte-for-byte untouched', () => {
    const unrelated = { payload: { detail: SECRET } }
    expect(redactIdentityInvitationJobData('default', 'send-email', unrelated)).toBe(
      unrelated,
    )
    expect(
      redactIdentityInvitationJobData('domain-events', 'review.created', unrelated),
    ).toBe(unrelated)
  })

  it('returns content-free partial progress and an error count when a queue mutation fails', async () => {
    const updateFailure = Object.assign(new Error(SECRET), { name: 'RedisWriteError' })
    const failingJob = {
      id: 'job-1',
      name: 'insert-activity-log',
      data: {
        action: 'invited',
        resourceType: 'member',
        payload: { detail: SECRET },
      },
      failedReason: '',
      stacktrace: [],
      getLogs: vi.fn(async () => []),
      updateData: vi.fn(async () => {
        throw updateFailure
      }),
      updateErrorMetadata: vi.fn(async () => undefined),
      replaceLogs: vi.fn(async () => undefined),
    }
    const emptyQueue = (): InvitationFactQueue => ({
      isPaused: vi.fn(async () => true),
      getJobCounts: vi.fn(async () => ({ active: 0 })),
      getJobs: vi.fn(async () => []),
    })
    const defaultQueue: InvitationFactQueue = {
      ...emptyQueue(),
      getJobs: vi.fn(async (states) => (states[0] === 'waiting' ? [failingJob] : [])),
    }
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM identity_invitation_fact_contract')) {
        return {
          rows: [
            {
              issuance_version: 2,
              generation: 2,
              switched_at: new Date(),
              verified_at: null,
              operator_id: 'test',
              reason: 'test',
              updated_at: new Date(),
            },
          ],
        }
      }
      return { rows: [{ count: '0' }], rowCount: 0 }
    })

    const result = await scrubIdentityInvitationFactContract(
      {
        pool: { query } as unknown as Pool,
        defaultQueue,
        domainEventsQueue: emptyQueue(),
        quarantineQueue: emptyQueue(),
      },
      { batchSize: 10, apply: true },
    )

    expect(result).toMatchObject({
      changedTotal: 0,
      errorCount: 1,
      rerunRequired: true,
      errors: [
        { target: 'defaultQueue', code: 'mutation_failed', errorName: 'RedisWriteError' },
      ],
    })
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })
})
