import { describe, expect, it } from 'vitest'
import { SYNC_INBOX_ITEMS_FROM_HEADS_SQL } from '#/shared/testing/inbox-cycle-head-sync'
import { createResponseTargetPolicyStore } from './policy.store.server'
import { createResponseTargetStore } from './store.server'
import {
  db,
  FEEDBACK,
  ITEM,
  LEGACY_FEEDBACK,
  LEGACY_ITEM,
  MANAGER,
  OPENED_AT,
  ORG,
  pool,
  PROPERTY,
  seedScope,
  useResponseTargetDatabase,
} from './store.test-fixtures'

useResponseTargetDatabase()

describe.sequential('Inbox Response Target store (PostgreSQL)', () => {
  it('enforces immutable snapshots and excludes cancelled and legacy-unknown cycles from performance', async () => {
    await seedScope({ propertyMinutes: null })
    const targets = createResponseTargetStore(db)
    await db.transaction(async (tx) => {
      const { cancelPrivateFeedbackTarget } = await import('./store.server')
      await cancelPrivateFeedbackTarget(
        tx,
        {
          inboxItemId: ITEM,
          organizationId: ORG,
          propertyId: PROPERTY,
          sourceType: 'feedback',
          sourceId: FEEDBACK,
          currentCycleNumber: 1,
          currentSourceRevision: 1,
          stateRevision: 1,
          status: 'open',
        },
        new Date('2026-08-28T09:00:00.000Z'),
      )
    })
    await pool.query(
      `INSERT INTO inbox_items (
         id, organization_id, property_id, source_type, source_id, status,
         source_date, command_revision, created_at, updated_at
       ) VALUES ($1, $2, $3, 'feedback', $4, 'open', $5, 1, $5, $5)`,
      [LEGACY_ITEM, ORG, PROPERTY, LEGACY_FEEDBACK, OPENED_AT],
    )
    await pool.query(
      `INSERT INTO inbox_handling_cycles (
         inbox_item_id, cycle_number, organization_id, property_id,
         source_type, source_id, source_revision, opened_reason, opened_at,
         created_at
       ) VALUES ($1, 1, $2, $3, 'feedback', $4, 1, 'legacy_backfill', $5, $5)`,
      [LEGACY_ITEM, ORG, PROPERTY, LEGACY_FEEDBACK, OPENED_AT],
    )
    await pool.query(
      `INSERT INTO inbox_handling_cycle_heads (
         inbox_item_id, organization_id, property_id, source_type, source_id,
         current_source_revision, current_cycle_number, state_revision, status,
         created_at, updated_at
       ) VALUES ($1, $2, $3, 'feedback', $4, 1, 1, 1, 'open', $5, $5)`,
      [LEGACY_ITEM, ORG, PROPERTY, LEGACY_FEEDBACK, OPENED_AT],
    )
    await pool.query(SYNC_INBOX_ITEMS_FROM_HEADS_SQL)
    await pool.query(
      `INSERT INTO inbox_handling_cycle_response_targets (
         inbox_item_id, cycle_number, organization_id, property_id,
         source_type, source_id, source_revision, target_kind,
         performance_eligibility, created_at, updated_at
       ) VALUES (
         $1, 1, $2, $3, 'feedback', $4, 1,
         'private_feedback_handling', 'legacy_unknown', $5, $5
       )`,
      [LEGACY_ITEM, ORG, PROPERTY, LEGACY_FEEDBACK, OPENED_AT],
    )
    await expect(
      targets.getPrivateFeedbackAnalytics({
        organizationId: ORG,
        propertyIds: [PROPERTY],
        now: new Date('2026-09-01T08:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      measuredCycleCount: 0,
      activeCount: 0,
      currentOverdueCount: 0,
      handledOnTimeCount: 0,
      handledLateCount: 0,
    })
    await expect(
      pool.query(
        `UPDATE inbox_handling_cycle_response_targets
         SET duration_minutes = 60 WHERE inbox_item_id = $1`,
        [ITEM],
      ),
    ).rejects.toThrow('cannot be rewritten')
    await expect(
      pool.query(
        `INSERT INTO inbox_response_target_reminders (
           inbox_item_id, cycle_number, reminder_kind, organization_id,
           property_id, target_kind, scheduled_for
         ) SELECT inbox_item_id, cycle_number, 'halfway', organization_id,
                  property_id, target_kind, start_at
           FROM inbox_handling_cycle_response_targets WHERE inbox_item_id = $1`,
        [ITEM],
      ),
    ).rejects.toThrow('schedule does not match')
    await expect(
      pool.query(
        `INSERT INTO inbox_response_target_reminders (
           inbox_item_id, cycle_number, reminder_kind, organization_id,
           property_id, target_kind, scheduled_for
         ) SELECT inbox_item_id, cycle_number, 'halfway', organization_id,
                  property_id, target_kind,
                  start_at + make_interval(secs => duration_minutes * 30)
           FROM inbox_handling_cycle_response_targets WHERE inbox_item_id = $1`,
        [ITEM],
      ),
    ).rejects.toThrow('duplicate key')
  })

  it('serializes policy creation and fences stale Organization and Property updates', async () => {
    await seedScope()
    const policies = createResponseTargetPolicyStore(db)
    await expect(policies.getPolicySettings(ORG, PROPERTY)).resolves.toEqual({
      organization: {
        googleReviewResponse: {
          targetKind: 'google_review_response',
          durationMinutes: 2_880,
          policySource: 'builtin_default',
          policyVersion: null,
          lowRating: null,
        },
        privateFeedbackHandling: {
          targetKind: 'private_feedback_handling',
          durationMinutes: 2_880,
          policySource: 'builtin_default',
          policyVersion: null,
          lowRating: null,
        },
      },
      privateFeedbackPropertyOverride: {
        propertyId: PROPERTY,
        durationMinutes: null,
        policyVersion: null,
        effectiveDurationMinutes: 2_880,
        effectiveSource: 'builtin_default',
      },
    })
    await expect(
      policies.setOrganizationPolicy({
        organizationId: ORG,
        targetKind: 'private_feedback_handling',
        durationMinutes: null as never,
        expectedPolicyVersion: null,
        actorUserId: MANAGER,
        at: new Date('2026-08-28T09:59:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    const organizationCommand = {
      organizationId: ORG,
      targetKind: 'private_feedback_handling' as const,
      durationMinutes: 2_880,
      expectedPolicyVersion: null,
      actorUserId: MANAGER,
      at: new Date('2026-08-28T10:00:00.000Z'),
    }

    const race = await Promise.allSettled([
      policies.setOrganizationPolicy(organizationCommand),
      policies.setOrganizationPolicy(organizationCommand),
    ])
    expect(race.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(race.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const organizationRow = await pool.query(
      `SELECT duration_minutes, policy_version::int
       FROM inbox_response_target_organization_policies
       WHERE organization_id = $1 AND target_kind = 'private_feedback_handling'`,
      [ORG],
    )
    expect(organizationRow.rows).toEqual([{ duration_minutes: 2_880, policy_version: 1 }])

    await expect(
      policies.setPrivateFeedbackPropertyOverride({
        organizationId: ORG,
        propertyId: PROPERTY,
        durationMinutes: 720,
        expectedPolicyVersion: null,
        actorUserId: MANAGER,
        at: new Date('2026-08-28T10:01:00.000Z'),
      }),
    ).resolves.toMatchObject({ durationMinutes: 720, policyVersion: 1 })
    await expect(
      policies.setPrivateFeedbackPropertyOverride({
        organizationId: ORG,
        propertyId: PROPERTY,
        durationMinutes: null,
        expectedPolicyVersion: 1,
        actorUserId: MANAGER,
        at: new Date('2026-08-28T10:02:00.000Z'),
      }),
    ).resolves.toMatchObject({ durationMinutes: null, policyVersion: 2 })
    await expect(
      policies.setPrivateFeedbackPropertyOverride({
        organizationId: ORG,
        propertyId: PROPERTY,
        durationMinutes: 60,
        expectedPolicyVersion: 1,
        actorUserId: MANAGER,
        at: new Date('2026-08-28T10:03:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'revision_conflict' })

    const propertyRow = await pool.query(
      `SELECT enabled, duration_minutes, policy_version::int
       FROM inbox_private_feedback_target_property_overrides
       WHERE organization_id = $1 AND property_id = $2`,
      [ORG, PROPERTY],
    )
    expect(propertyRow.rows).toEqual([
      { enabled: false, duration_minutes: null, policy_version: 2 },
    ])
    await expect(policies.getPolicySettings(ORG, PROPERTY)).resolves.toMatchObject({
      organization: {
        privateFeedbackHandling: {
          durationMinutes: 2_880,
          policySource: 'organization_policy',
          policyVersion: 1,
        },
      },
      privateFeedbackPropertyOverride: {
        durationMinutes: null,
        policyVersion: 2,
        effectiveDurationMinutes: 2_880,
        effectiveSource: 'organization_policy',
      },
    })
    const facts = await pool.query(
      `SELECT count(*)::int AS count
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'inbox.response_target.policy_changed'`,
      [ORG],
    )
    expect(facts.rows).toEqual([{ count: 3 }])
  })

  // A command that omits the low-rating pair keeps the stored one, so the
  // "shorter than the ordinary target" rule has to be asked of the row the
  // write leaves behind. Asked of the command alone it passed, and the table's
  // CHECK constraint then refused the row as an untagged database error.
  it('refuses, as a business error, an ordinary target shorter than the low-rating target it keeps', async () => {
    await seedScope()
    const policies = createResponseTargetPolicyStore(db)
    const google = {
      organizationId: ORG,
      targetKind: 'google_review_response' as const,
      actorUserId: MANAGER,
    }
    await policies.setOrganizationPolicy({
      ...google,
      durationMinutes: 2_880,
      lowRating: { threshold: 2, durationMinutes: 240 },
      expectedPolicyVersion: null,
      at: new Date('2026-08-28T10:00:00.000Z'),
    })
    const storedPolicy = () =>
      pool.query(
        `SELECT duration_minutes, low_rating_threshold,
                low_rating_duration_minutes, policy_version::int
         FROM inbox_response_target_organization_policies
         WHERE organization_id = $1 AND target_kind = 'google_review_response'`,
        [ORG],
      )

    await expect(
      policies.setOrganizationPolicy({
        ...google,
        durationMinutes: 120,
        expectedPolicyVersion: 1,
        at: new Date('2026-08-28T10:01:00.000Z'),
      }),
    ).rejects.toMatchObject({
      _tag: 'InboxError',
      code: 'invalid_input',
      message: 'The low-rating target must be shorter than the ordinary target',
    })
    expect((await storedPolicy()).rows).toEqual([
      {
        duration_minutes: 2_880,
        low_rating_threshold: 2,
        low_rating_duration_minutes: 240,
        policy_version: 1,
      },
    ])

    // The same omission is fine while the kept pair still fits, and a stale
    // editor is still told to reload before being told about the pair.
    await expect(
      policies.setOrganizationPolicy({
        ...google,
        durationMinutes: 120,
        expectedPolicyVersion: 7,
        at: new Date('2026-08-28T10:02:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'revision_conflict' })
    await expect(
      policies.setOrganizationPolicy({
        ...google,
        durationMinutes: 240,
        expectedPolicyVersion: 1,
        at: new Date('2026-08-28T10:03:00.000Z'),
      }),
    ).resolves.toMatchObject({ durationMinutes: 240, policyVersion: 2 })
    expect((await storedPolicy()).rows).toEqual([
      {
        duration_minutes: 240,
        low_rating_threshold: 2,
        low_rating_duration_minutes: 240,
        policy_version: 2,
      },
    ])
  })
})
