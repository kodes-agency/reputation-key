import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { seedOutboxEvents } from '#/shared/db/testing/outbox-event-fixture'
import {
  seedNotice,
  seedReceipts,
  type NoticeSeed,
} from '../email/delivery-seed.test-fixtures'
import { readNotificationDeliveryLag } from './delivery-lag.server'
import {
  STATEMENT_TIMEOUT_MS,
  acceptance,
  acceptedAt,
  clearOrganization,
  type LagWindow,
} from './delivery-lag.test-fixtures'

const ORG = organizationId('notification-delivery-lag-org')
const PROPERTY = propertyId('83000000-0000-4000-8000-000000000001')
const SOURCE_PENDING = '83000000-0000-4000-8000-000000000002'
const MATERIALIZATION_PENDING = '83000000-0000-4000-8000-000000000003'
const UNRELATED_ENQUEUE = '83000000-0000-4000-8000-000000000004'
const ACCEPTED_EMAIL_SOURCE = '83000000-0000-4000-8000-000000000005'
const PENDING_EMAIL_SOURCE = '83000000-0000-4000-8000-000000000006'
const SECOND_ACCEPTED_EMAIL_SOURCE = '83000000-0000-4000-8000-000000000007'
const HELD_ACCEPTED_EMAIL_SOURCE = '83000000-0000-4000-8000-000000000008'
const ORGANIZATION_ACCEPTED_EMAIL_SOURCE = '83000000-0000-4000-8000-000000000009'
const RECORDED = new Date('2026-08-27T07:50:00.000Z')
const ACCEPTED_SOURCE_RECORDED = new Date('2026-08-27T07:48:00.000Z')
const PENDING_SOURCE_RECORDED = new Date('2026-08-27T07:49:00.000Z')
const SECOND_ACCEPTED_SOURCE_RECORDED = new Date('2026-08-27T07:47:00.000Z')
const HELD_ACCEPTED_SOURCE_RECORDED = new Date('2026-08-27T07:40:00.000Z')
const ORGANIZATION_ACCEPTED_SOURCE_RECORDED = new Date('2026-08-27T07:46:00.000Z')
const MAIN_WINDOW = {
  recordedAtOrAfter: new Date('2026-08-27T07:00:00.000Z'),
  recordedBefore: new Date('2026-08-27T07:55:00.000Z'),
}
const mainWindow = (
  overrides: Partial<NonNullable<LagWindow>> = {},
): NonNullable<LagWindow> => ({
  ...MAIN_WINDOW,
  scanLimit: 10,
  statementTimeoutMs: STATEMENT_TIMEOUT_MS,
  ...overrides,
})

const REVIEW_EVENT = {
  eventType: 'review.reply.publish_failed',
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: 'review',
} as const
const LAG_USER = 'notification-email-user'
const immediateNotice = (
  name: string,
  title: string,
  eventId: string,
  createdAt: Date,
  email: NonNullable<NoticeSeed['email']>,
): NoticeSeed => ({
  name: `lag-${name}`,
  organizationId: ORG,
  userId: LAG_USER,
  propertyId: PROPERTY,
  priority: 'urgent',
  resourceType: 'inbox_item',
  title,
  eventId,
  createdAt,
  email: { cadence: 'immediate', ...email },
})

describe.sequential('notification delivery lag report (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    await clearOrganization(db, ORG)
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Lag Report Property',
      slug: 'notification-delivery-lag',
      timezone: 'UTC',
    })
    await seedOutboxEvents(db, [
      {
        id: SOURCE_PENDING,
        eventType: 'inbox.inbox_item.assigned',
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceContext: 'inbox',
        sourceAggregateId: '83000000-0000-4000-8000-000000000010',
        at: RECORDED,
        payload: { private: 'must-never-be-selected' },
      },
      {
        id: MATERIALIZATION_PENDING,
        eventType: 'inbox.inbox_item.assigned',
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceContext: 'inbox',
        sourceAggregateId: '83000000-0000-4000-8000-000000000011',
        at: RECORDED,
        payload: { private: 'must-never-be-selected' },
      },
      {
        id: UNRELATED_ENQUEUE,
        eventType: 'metric.corrected',
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceContext: 'metric',
        sourceAggregateId: '83000000-0000-4000-8000-000000000012',
        at: RECORDED,
        payload: { private: 'also-must-never-be-selected' },
      },
      {
        ...REVIEW_EVENT,
        id: ACCEPTED_EMAIL_SOURCE,
        sourceAggregateId: '83000000-0000-4000-8000-000000000013',
        at: ACCEPTED_SOURCE_RECORDED,
        payload: { private: 'must-never-enter-email-health' },
      },
      {
        ...REVIEW_EVENT,
        id: PENDING_EMAIL_SOURCE,
        sourceAggregateId: '83000000-0000-4000-8000-000000000014',
        at: PENDING_SOURCE_RECORDED,
        payload: { private: 'must-never-enter-email-health' },
      },
      {
        ...REVIEW_EVENT,
        id: SECOND_ACCEPTED_EMAIL_SOURCE,
        sourceAggregateId: '83000000-0000-4000-8000-000000000015',
        at: SECOND_ACCEPTED_SOURCE_RECORDED,
        payload: { private: 'must-never-enter-email-health' },
      },
      {
        ...REVIEW_EVENT,
        id: HELD_ACCEPTED_EMAIL_SOURCE,
        sourceAggregateId: '83000000-0000-4000-8000-000000000016',
        at: HELD_ACCEPTED_SOURCE_RECORDED,
        payload: { private: 'held-content-must-never-enter-email-health' },
      },
      {
        id: ORGANIZATION_ACCEPTED_EMAIL_SOURCE,
        eventType: 'identity.member.removed',
        organizationId: ORG,
        propertyId: null,
        sourceContext: 'identity',
        sourceAggregateId: 'notification-account-user',
        at: ORGANIZATION_ACCEPTED_SOURCE_RECORDED,
        payload: { memberUserId: 'notification-account-user' },
      },
    ])
    const at = (time: string) => new Date(`2026-08-27T${time}.000Z`)
    await seedNotice(
      db,
      immediateNotice(
        'accepted',
        'Accepted email evidence',
        ACCEPTED_EMAIL_SOURCE,
        ACCEPTED_SOURCE_RECORDED,
        {
          idempotencyKey: 'notification-email-accepted',
          ...acceptedAt(at('07:51:00')),
        },
      ),
    )
    await seedNotice(
      db,
      immediateNotice(
        'pending',
        'Pending email evidence',
        PENDING_EMAIL_SOURCE,
        PENDING_SOURCE_RECORDED,
        {
          status: 'failed',
          idempotencyKey: 'notification-email-pending',
          lastErrorClass: 'transient',
          attemptedAt: RECORDED,
          nextAttemptAt: at('07:54:00'),
          retryCount: 7,
          updatedAt: RECORDED,
        },
      ),
    )
    await seedNotice(
      db,
      immediateNotice(
        'unlinked',
        'Unlinked email evidence',
        '83000000-0000-4000-8000-000000000099',
        RECORDED,
        { status: 'pending', idempotencyKey: 'notification-email-unlinked' },
      ),
    )
    await seedNotice(
      db,
      immediateNotice(
        'second-accepted',
        'Second accepted email evidence',
        SECOND_ACCEPTED_EMAIL_SOURCE,
        SECOND_ACCEPTED_SOURCE_RECORDED,
        {
          idempotencyKey: 'notification-email-second-accepted',
          ...acceptedAt(at('07:48:00')),
        },
      ),
    )
    await seedNotice(
      db,
      immediateNotice(
        'held-accepted',
        'Policy-held accepted email evidence',
        HELD_ACCEPTED_EMAIL_SOURCE,
        HELD_ACCEPTED_SOURCE_RECORDED,
        {
          idempotencyKey: 'notification-email-held-accepted',
          // This hold is deliberately retained after acceptance. Its fourteen-
          // minute source-to-acceptance interval must not enter the immediate
          // five-minute target or it would manufacture a quiet-hours breach.
          notBefore: at('07:53:00'),
          ...acceptedAt(at('07:54:00')),
        },
      ),
    )
    await seedNotice(db, {
      name: 'lag-organization-accepted',
      organizationId: ORG,
      userId: 'notification-account-user',
      propertyId: null,
      type: 'account.organization_access_removed',
      category: 'mandatory',
      priority: 'normal',
      resourceType: 'organization',
      resourceId: ORG,
      title: 'Organization account evidence',
      eventId: ORGANIZATION_ACCEPTED_EMAIL_SOURCE,
      createdAt: ORGANIZATION_ACCEPTED_SOURCE_RECORDED,
      email: {
        cadence: 'immediate',
        idempotencyKey: 'notification-email-organization-accepted',
        ...acceptedAt(at('07:47:00')),
      },
    })
    await seedReceipts(db, [
      {
        eventId: ACCEPTED_EMAIL_SOURCE,
        consumerName: 'notification.on-review-reply-publish_failed',
        at: at('07:50:30'),
      },
      {
        eventId: PENDING_EMAIL_SOURCE,
        consumerName: 'notification.on-review-reply-publish_failed',
        at: RECORDED,
      },
      {
        eventId: SECOND_ACCEPTED_EMAIL_SOURCE,
        consumerName: 'notification.on-review-reply-publish_failed',
        at: at('07:47:30'),
      },
      {
        eventId: HELD_ACCEPTED_EMAIL_SOURCE,
        consumerName: 'notification.on-review-reply-publish_failed',
        at: at('07:41:00'),
      },
      {
        eventId: ORGANIZATION_ACCEPTED_EMAIL_SOURCE,
        consumerName: 'notification.on-identity-member-removed',
        at: at('07:46:30'),
      },
      {
        eventId: MATERIALIZATION_PENDING,
        consumerName: 'notification.on-inbox-inbox_item-assigned',
        at: RECORDED,
      },
      {
        eventId: UNRELATED_ENQUEUE,
        consumerName: 'notification.enqueue:notification.on-retired-family:abc123',
        at: RECORDED,
      },
      {
        eventId: MATERIALIZATION_PENDING,
        consumerName:
          'notification.enqueue:notification.on-inbox-inbox_item-assigned:abc123',
        at: RECORDED,
      },
    ])
  })

  afterAll(async () => {
    if (db) await clearOrganization(db, ORG)
    await lease?.release()
  })

  it('installs the partial provider-acceptance scan index in PostgreSQL', async () => {
    const result = await lease.pool.query<{ indexdef: string }>(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'notification_email_queue'
        AND indexname = 'notification_email_queue_immediate_acceptance_health_idx'
    `)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.indexdef).toMatch(/\(created_at DESC[^,]*, id\)/u)
    expect(result.rows[0]?.indexdef).toMatch(
      /WHERE .*cadence.*=.*'immediate'.*not_before IS NULL/iu,
    )
  })

  it('reports bounded lag, excludes retained policy holds, and exposes no payloads', async () => {
    const readLag = (overrides: Partial<NonNullable<LagWindow>> = {}) =>
      readNotificationDeliveryLag(db, () => true, mainWindow(overrides))
    const report = await readLag()
    const mainAcceptance = acceptance({
      awaitingProviderAcceptance: 2,
      attemptedAwaitingProviderAcceptance: 1,
      oldestAwaitingSourceRecordedAt: PENDING_SOURCE_RECORDED,
      acceptedLatencyP99Ms: 180_000,
      acceptedSampleCount: 3,
      sourceUnlinked: 1,
    })

    expect(report).toEqual({
      sourceReceiptPending: 1,
      sourceReceiptPendingByEventType: { 'inbox.inbox_item.assigned': 1 },
      materializationPending: 1,
      oldestSourceRecordedAt: RECORDED,
      oldestMaterializationSourceRecordedAt: RECORDED,
      oldestMaterializationEnqueuedAt: RECORDED,
      sourceSaturated: false,
      materializationSaturated: false,
      immediateEmailAcceptance: mainAcceptance,
    })
    expect(JSON.stringify(report)).not.toContain('must-never-be-selected')
    expect(JSON.stringify(report)).not.toContain('also-must-never-be-selected')
    expect(JSON.stringify(report)).not.toContain(
      'held-content-must-never-enter-email-health',
    )

    await expect(readLag({ scanLimit: 1 })).resolves.toMatchObject({
      sourceReceiptPending: 1,
      materializationPending: 1,
      sourceSaturated: true,
      materializationSaturated: true,
      immediateEmailAcceptance: expect.objectContaining({
        acceptedLatencyP99Ms: null,
        saturated: true,
      }),
    })
    await expect(readLag({ scanLimit: 0 })).rejects.toThrow(
      'scanLimit must be a positive integer',
    )
    await expect(readLag({ scanLimit: 1001 })).rejects.toThrow(
      'scanLimit must not exceed 1000',
    )
    await expect(
      readLag({ recordedAtOrAfter: new Date('2026-08-27T08:00:00.000Z') }),
    ).rejects.toThrow('recordedAtOrAfter must precede recordedBefore')
    await expect(readLag({ statementTimeoutMs: 0 })).rejects.toThrow(
      'statementTimeoutMs must be a positive integer',
    )

    await seedReceipts(db, [
      {
        eventId: SOURCE_PENDING,
        consumerName: 'notification.on-inbox-inbox_item-assigned',
        at: RECORDED,
      },
      {
        eventId: MATERIALIZATION_PENDING,
        consumerName:
          'notification.materialized:notification.on-inbox-inbox_item-assigned:abc123',
        at: RECORDED,
      },
    ])

    await expect(readLag()).resolves.toEqual({
      sourceReceiptPending: 0,
      sourceReceiptPendingByEventType: {},
      materializationPending: 0,
      oldestSourceRecordedAt: null,
      oldestMaterializationSourceRecordedAt: null,
      oldestMaterializationEnqueuedAt: null,
      sourceSaturated: false,
      materializationSaturated: false,
      immediateEmailAcceptance: mainAcceptance,
    })
  })
})

// The five-minute acceptance target only means something where email may be
// sent. An Organization whose `notification.send_email` capability is denied
// (not allowlisted, suspended, killed) still gets pending immediate rows, and
// nothing will ever attempt them.
const SCOPE_WINDOW_START = new Date('2026-08-28T07:00:00.000Z')
const SCOPE_WINDOW_END = new Date('2026-08-28T07:55:00.000Z')
const ALLOWED_ORG = organizationId('notification-delivery-lag-allowed-org')
const DARK_ORG = organizationId('notification-delivery-lag-dark-org')
const ALLOWED_PROPERTY = propertyId('84000000-0000-4000-8000-000000000001')
const DARK_PROPERTY = propertyId('84000000-0000-4000-8000-000000000002')
const ALLOWED_ACCEPTED_SOURCE = '84000000-0000-4000-8000-000000000010'
const ALLOWED_REAUTH_SOURCE = '84000000-0000-4000-8000-000000000011'
const DARK_PENDING_SOURCE = '84000000-0000-4000-8000-000000000012'
const ALLOWED_ACCEPTED_SOURCE_RECORDED = new Date('2026-08-28T07:48:00.000Z')
const ALLOWED_REAUTH_SOURCE_RECORDED = new Date('2026-08-28T07:40:00.000Z')
const DARK_PENDING_SOURCE_RECORDED = new Date('2026-08-28T07:10:00.000Z')
const ARCHIVED_PROPERTY = propertyId('84000000-0000-4000-8000-000000000050')
const SCOPE_USER = 'lag-scope-user'

const scopeWindow = (scanLimit: number): NonNullable<LagWindow> => ({
  recordedAtOrAfter: SCOPE_WINDOW_START,
  recordedBefore: SCOPE_WINDOW_END,
  scanLimit,
  statementTimeoutMs: STATEMENT_TIMEOUT_MS,
})

/** A notice in the scope suite's organizations, with its immediate email. */
const scopeNotice = (
  seed: Pick<NoticeSeed, 'name' | 'title' | 'eventId' | 'createdAt'> &
    Partial<NoticeSeed> & {
      organizationId: string
      propertyId: string
      email: NonNullable<NoticeSeed['email']>
    },
): NoticeSeed => ({
  userId: SCOPE_USER,
  priority: 'urgent',
  resourceType: 'inbox_item',
  ...seed,
  email: { cadence: 'immediate', ...seed.email },
})

describe.sequential(
  'notification email acceptance by delivery scope (real PostgreSQL)',
  () => {
    let lease: TestLease
    let db: Database

    const cleanup = async () => {
      for (const org of [ALLOWED_ORG, DARK_ORG]) {
        if (db) await clearOrganization(db, org)
      }
    }

    /** Asks which scopes were judged, and allows only the allowed Organization. */
    const readAllowedScopes = (scanLimit: number) => {
      const asked: Array<{ organizationId: string; propertyId: string | null }> = []
      const read = () =>
        readNotificationDeliveryLag(
          db,
          (scope) => {
            asked.push(scope)
            return scope.organizationId === ALLOWED_ORG
          },
          scopeWindow(scanLimit),
        )
      return { asked, read }
    }

    beforeAll(async () => {
      lease = await acquireTestLease(getEnv().DATABASE_URL)
      db = drizzle(lease.pool) as Database
      await cleanup()
      await db.insert(properties).values([
        {
          id: ALLOWED_PROPERTY,
          organizationId: ALLOWED_ORG,
          name: 'Email Allowed Property',
          slug: 'notification-delivery-lag-allowed',
          timezone: 'UTC',
        },
        {
          id: DARK_PROPERTY,
          organizationId: DARK_ORG,
          name: 'Email Dark Property',
          slug: 'notification-delivery-lag-dark',
          timezone: 'UTC',
        },
      ])
      await seedOutboxEvents(db, [
        {
          id: ALLOWED_ACCEPTED_SOURCE,
          eventType: 'review.reply.publish_failed',
          organizationId: ALLOWED_ORG,
          propertyId: ALLOWED_PROPERTY,
          sourceContext: 'review',
          sourceAggregateId: '84000000-0000-4000-8000-000000000030',
          at: ALLOWED_ACCEPTED_SOURCE_RECORDED,
        },
        {
          // An Organization-level source: the Google account is not a Property,
          // though its notice is anchored to one.
          id: ALLOWED_REAUTH_SOURCE,
          eventType: 'integration.google_account.reauthorization_required',
          organizationId: ALLOWED_ORG,
          propertyId: null,
          sourceContext: 'integration',
          sourceAggregateId: '84000000-0000-4000-8000-000000000031',
          at: ALLOWED_REAUTH_SOURCE_RECORDED,
        },
        {
          id: DARK_PENDING_SOURCE,
          eventType: 'review.reply.publish_failed',
          organizationId: DARK_ORG,
          propertyId: DARK_PROPERTY,
          sourceContext: 'review',
          sourceAggregateId: '84000000-0000-4000-8000-000000000032',
          at: DARK_PENDING_SOURCE_RECORDED,
        },
      ])
      await seedNotice(
        db,
        scopeNotice({
          name: 'lag-scope-allowed-accepted',
          organizationId: ALLOWED_ORG,
          propertyId: ALLOWED_PROPERTY,
          title: 'Accepted in an allowed scope',
          eventId: ALLOWED_ACCEPTED_SOURCE,
          createdAt: ALLOWED_ACCEPTED_SOURCE_RECORDED,
          email: {
            idempotencyKey: 'lag-scope-allowed-accepted',
            ...acceptedAt(new Date('2026-08-28T07:49:00.000Z')),
          },
        }),
      )
      await seedNotice(
        db,
        scopeNotice({
          name: 'lag-scope-allowed-reauth',
          organizationId: ALLOWED_ORG,
          propertyId: ALLOWED_PROPERTY,
          type: 'integration.reauthorization_required',
          resourceType: 'property',
          resourceId: ALLOWED_PROPERTY,
          title: 'Reauthorization in an allowed scope',
          eventId: ALLOWED_REAUTH_SOURCE,
          createdAt: ALLOWED_REAUTH_SOURCE_RECORDED,
          email: { status: 'pending', idempotencyKey: 'lag-scope-allowed-reauth' },
        }),
      )
      await seedNotice(
        db,
        scopeNotice({
          name: 'lag-scope-dark-pending',
          organizationId: DARK_ORG,
          propertyId: DARK_PROPERTY,
          title: 'Pending in a capability-dark scope',
          eventId: DARK_PENDING_SOURCE,
          createdAt: DARK_PENDING_SOURCE_RECORDED,
          email: { status: 'pending', idempotencyKey: 'lag-scope-dark-pending' },
        }),
      )
    })

    afterAll(async () => {
      await cleanup()
      await lease?.release()
    })

    /** What the allowed scope reports once only its reauthorization row waits. */
    const allowedScopeAcceptance = acceptance({
      awaitingProviderAcceptance: 1,
      oldestAwaitingSourceRecordedAt: ALLOWED_REAUTH_SOURCE_RECORDED,
      acceptedLatencyP99Ms: 60_000,
      acceptedSampleCount: 1,
    })

    it('judges only scopes where email may send, and links Organization-level sources', async () => {
      const { asked, read } = readAllowedScopes(10)

      const report = await read()

      // The dark Organization's untouched pending row is not an acceptance
      // candidate; the allowed reauthorization row is, with its source clock.
      expect(report.immediateEmailAcceptance).toEqual(allowedScopeAcceptance)
      expect(asked).toContainEqual({
        organizationId: DARK_ORG,
        propertyId: DARK_PROPERTY,
      })
      expect(asked).toContainEqual({
        organizationId: ALLOWED_ORG,
        propertyId: ALLOWED_PROPERTY,
      })
    })

    it('bounds its scan by sendable rows, so a dark backlog can neither saturate nor crowd it', async () => {
      // Newer than every allowed row: a newest-first scan meets them first.
      const darkBacklog = [
        {
          name: 'lag-scope-dark-backlog-1',
          createdAt: new Date('2026-08-28T07:52:00.000Z'),
        },
        {
          name: 'lag-scope-dark-backlog-2',
          createdAt: new Date('2026-08-28T07:50:00.000Z'),
        },
      ]
      for (const { name, createdAt } of darkBacklog) {
        await seedNotice(
          db,
          scopeNotice({
            name,
            organizationId: DARK_ORG,
            propertyId: DARK_PROPERTY,
            title: 'Pending in a capability-dark scope',
            eventId: DARK_PENDING_SOURCE,
            createdAt,
            email: { status: 'pending', idempotencyKey: name },
          }),
        )
      }

      // Two sendable rows fit a two-row bound whatever the dark scope holds.
      const bounded = await readNotificationDeliveryLag(
        db,
        (scope) => scope.organizationId === ALLOWED_ORG,
        scopeWindow(2),
      )
      expect(bounded.immediateEmailAcceptance).toEqual(allowedScopeAcceptance)

      // Email dark everywhere: nothing to judge, and nothing saturated.
      const quiet = await readNotificationDeliveryLag(db, () => false, scopeWindow(1))
      expect(quiet.immediateEmailAcceptance).toEqual(acceptance())
    })

    it('holds, and never judges, the rows of a Property that is no longer active', async () => {
      // An allowed Organization archives a Property with an urgent email still
      // queued. Every send path holds that row until the Property is restored,
      // so it is not late mail, and it is newer than every allowed row, so it
      // must not crowd them out of a bounded scan either.
      const heldAt = new Date('2026-08-28T07:53:00.000Z')
      await db.insert(properties).values({
        id: ARCHIVED_PROPERTY,
        organizationId: ALLOWED_ORG,
        name: 'Email Archived Property',
        slug: 'notification-delivery-lag-archived',
        timezone: 'UTC',
        lifecycleState: 'archived',
      })
      await seedNotice(
        db,
        scopeNotice({
          name: 'lag-scope-archived-pending',
          organizationId: ALLOWED_ORG,
          propertyId: ARCHIVED_PROPERTY,
          title: 'Pending for an archived Property',
          eventId: ALLOWED_ACCEPTED_SOURCE,
          createdAt: heldAt,
          email: { status: 'pending', idempotencyKey: 'lag-scope-archived-pending' },
        }),
      )
      const { asked, read } = readAllowedScopes(2)

      const report = await read()

      expect(report.immediateEmailAcceptance).toEqual(allowedScopeAcceptance)
      expect(asked).not.toContainEqual({
        organizationId: ALLOWED_ORG,
        propertyId: ARCHIVED_PROPERTY,
      })
    })
  },
)
