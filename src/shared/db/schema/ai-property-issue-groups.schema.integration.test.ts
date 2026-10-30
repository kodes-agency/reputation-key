// Migration 0079 against PostgreSQL: bounded phrases and manager metadata,
// tenant/topic composite references, active uniqueness and cascade behavior.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  type AiAnalysisFixture,
  installAiAnalysisFixture,
} from '#/shared/db/testing/ai-review-analysis-v3-fixture'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

const ORGANIZATION_ID = 'ai-issue-schema-test-org'
const PROPERTY_ID = '7a390000-0000-4000-8000-000000000001'
const NOW = new Date('2026-10-30T08:00:00.000Z')
const EXPIRES_AT = new Date('2028-10-29T08:00:00.000Z')

let lease: TestLease
let db: Database
let fixture: AiAnalysisFixture

type GroupInput = Readonly<{
  id?: string
  topic?: string
  canonicalThing?: string | null
  canonicalKey?: string
  displayName?: string | null
  mergedIntoIssueId?: string | null
  hiddenAt?: Date | null
  hiddenBy?: string | null
  normalizationVersion?: string
}>

async function insertGroup(input: GroupInput = {}): Promise<string> {
  const id = input.id ?? randomUUID()
  await lease.pool.query(
    `INSERT INTO ai_property_issue_groups (
       id, organization_id, property_id, topic, canonical_thing, canonical_key,
       display_name, merged_into_issue_id, hidden_at, hidden_by, created_at,
       updated_at, last_seen_at, expires_at, normalization_version
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $11, $12, $13)`,
    [
      id,
      ORGANIZATION_ID,
      PROPERTY_ID,
      input.topic ?? 'facilities_equipment',
      input.canonicalThing === undefined ? 'air conditioning' : input.canonicalThing,
      input.canonicalKey ?? 'air conditioning',
      input.displayName ?? null,
      input.mergedIntoIssueId ?? null,
      input.hiddenAt ?? null,
      input.hiddenBy ?? null,
      NOW,
      EXPIRES_AT,
      input.normalizationVersion ?? 'property-issue-normalization-v1',
    ],
  )
  return id
}

async function insertMember(
  input: Readonly<{
    groupId: string
    topic?: string
    memberKey?: string
    memberThing?: string | null
    source?: string
  }>,
) {
  return lease.pool.query(
    `INSERT INTO ai_property_issue_members (
       issue_group_id, organization_id, property_id, topic, member_key,
       member_thing, source, created_at, last_seen_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [
      input.groupId,
      ORGANIZATION_ID,
      PROPERTY_ID,
      input.topic ?? 'facilities_equipment',
      input.memberKey ?? 'air conditioning',
      input.memberThing === undefined ? 'air conditioning' : input.memberThing,
      input.source ?? 'deterministic',
      NOW,
    ],
  )
}

const checkViolation = (constraint: string) => ({ code: '23514', constraint })

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL)
  db = drizzle(lease.pool)
  fixture = await installAiAnalysisFixture({
    db,
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    now: NOW,
  })
})

beforeEach(async () => fixture.reset())

afterAll(async () => {
  await fixture.remove()
  await lease.release()
})

describe.sequential('Property issue group schema', () => {
  it('accepts a bounded cause group, a topic-level group and both member sources', async () => {
    const cause = await insertGroup()
    const topic = await insertGroup({
      topic: 'cleanliness',
      canonicalThing: null,
      canonicalKey: '__topic__',
      displayName: 'General cleanliness',
      hiddenAt: NOW,
      hiddenBy: 'manager-schema',
    })

    await insertMember({ groupId: cause, source: 'deterministic' })
    await insertMember({
      groupId: topic,
      topic: 'cleanliness',
      memberKey: '__topic__',
      memberThing: null,
      source: 'manager',
    })

    const count = await lease.pool.query(
      `SELECT count(*)::int AS count FROM ai_property_issue_members
       WHERE organization_id = $1`,
      [ORGANIZATION_ID],
    )
    expect(count.rows[0]?.count).toBe(2)
  })

  it('refuses every invalid group check arm', async () => {
    await expect(insertGroup({ topic: 'other_topic' })).rejects.toMatchObject(
      checkViolation('ai_property_issue_groups_topic_valid'),
    )
    for (const invalid of [
      { canonicalThing: null, canonicalKey: 'room' },
      { canonicalThing: 'room', canonicalKey: '__topic__' },
      {
        canonicalThing: 'four word object phrase',
        canonicalKey: 'four word object phrase',
      },
    ] as const) {
      await expect(insertGroup(invalid)).rejects.toMatchObject(
        checkViolation('ai_property_issue_groups_canonical_valid'),
      )
    }
    await expect(insertGroup({ displayName: ' untrimmed' })).rejects.toMatchObject(
      checkViolation('ai_property_issue_groups_display_name_valid'),
    )
    await expect(insertGroup({ displayName: '' })).rejects.toMatchObject(
      checkViolation('ai_property_issue_groups_display_name_valid'),
    )
    await expect(insertGroup({ hiddenAt: NOW, hiddenBy: null })).rejects.toMatchObject(
      checkViolation('ai_property_issue_groups_hidden_valid'),
    )
    await expect(insertGroup({ hiddenAt: NOW, hiddenBy: '' })).rejects.toMatchObject(
      checkViolation('ai_property_issue_groups_hidden_valid'),
    )
    const selfId = randomUUID()
    await expect(
      insertGroup({ id: selfId, mergedIntoIssueId: selfId }),
    ).rejects.toMatchObject(checkViolation('ai_property_issue_groups_not_self_merged'))
    await expect(insertGroup({ normalizationVersion: '' })).rejects.toMatchObject(
      checkViolation('ai_property_issue_groups_normalization_version_valid'),
    )
  })

  it('holds bounded group columns to their declared widths', async () => {
    await insertGroup({ displayName: 'x'.repeat(80) })

    await expect(insertGroup({ displayName: 'x'.repeat(81) })).rejects.toMatchObject({
      code: '22001',
    })
    await expect(
      insertGroup({ normalizationVersion: 'x'.repeat(101) }),
    ).rejects.toMatchObject({ code: '22001' })
  })

  it('refuses every invalid member check arm', async () => {
    const groupId = await insertGroup()

    await expect(insertMember({ groupId, topic: 'other_topic' })).rejects.toMatchObject(
      checkViolation('ai_property_issue_members_topic_valid'),
    )
    await expect(
      insertMember({ groupId, memberKey: '__topic__', memberThing: 'room' }),
    ).rejects.toMatchObject(checkViolation('ai_property_issue_members_identity_valid'))
    await expect(
      insertMember({ groupId, memberKey: 'room', memberThing: null }),
    ).rejects.toMatchObject(checkViolation('ai_property_issue_members_identity_valid'))
    await expect(insertMember({ groupId, source: 'model' })).rejects.toMatchObject(
      checkViolation('ai_property_issue_members_source_valid'),
    )
  })

  it('refuses a member whose topic differs from its group', async () => {
    const groupId = await insertGroup()

    await expect(
      insertMember({
        groupId,
        topic: 'cleanliness',
        memberKey: 'room',
        memberThing: 'room',
      }),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'ai_property_issue_members_group_fk',
    })
  })

  it('allows one active canonical key and permits a replacement after merge', async () => {
    const source = await insertGroup()
    await expect(insertGroup()).rejects.toMatchObject({
      code: '23505',
      constraint: 'ai_property_issue_groups_canonical_active_unique',
    })
    const target = await insertGroup({
      canonicalThing: 'cooling unit',
      canonicalKey: 'cooling unit',
    })
    await lease.pool.query(
      `UPDATE ai_property_issue_groups SET merged_into_issue_id = $1
       WHERE organization_id = $2 AND property_id = $3 AND id = $4`,
      [target, ORGANIZATION_ID, PROPERTY_ID, source],
    )

    await expect(insertGroup()).resolves.toBeTypeOf('string')
  })

  it('refuses a contribution mention whose topic differs from its group', async () => {
    const groupId = await insertGroup()
    const key = await fixture.seedAnalysis({
      profile: 'review-analysis-v3',
      expiresAt: EXPIRES_AT,
      analysisSequence: 1,
      withContribution: true,
    })

    await expect(
      lease.pool.query(
        `INSERT INTO ai_property_aggregate_contribution_mentions (
           organization_id, property_id, review_id, source_epoch, source_revision,
           analysis_sequence, mention_ordinal, topic, polarity, strength, thing,
           issue, names_person, issue_group_id
         ) VALUES ($1, $2, $3, $4, $5, $6, 0, 'cleanliness', 'negative',
                   'clear', 'room', 'dirty', null, $7)`,
        [
          key.organizationId,
          key.propertyId,
          key.reviewId,
          key.sourceEpoch,
          key.sourceRevision,
          key.analysisSequence,
          groupId,
        ],
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'ai_property_aggregate_contribution_mentions_issue_group_fk',
    })
  })

  it('cascades redirects and members when their target is deleted', async () => {
    const target = await insertGroup({
      canonicalThing: 'cooling unit',
      canonicalKey: 'cooling unit',
    })
    const redirect = await insertGroup({ mergedIntoIssueId: target })
    await insertMember({ groupId: redirect })

    await lease.pool.query(
      `DELETE FROM ai_property_issue_groups
       WHERE organization_id = $1 AND property_id = $2 AND id = $3`,
      [ORGANIZATION_ID, PROPERTY_ID, target],
    )

    const rows = await lease.pool.query(
      `SELECT id FROM ai_property_issue_groups WHERE organization_id = $1
       UNION ALL
       SELECT issue_group_id AS id FROM ai_property_issue_members WHERE organization_id = $1`,
      [ORGANIZATION_ID],
    )
    expect(rows.rows).toEqual([])
  })

  it('refuses deleting a group a contribution still references', async () => {
    const groupId = await insertGroup()
    const key = await fixture.seedAnalysis({
      profile: 'review-analysis-v3',
      expiresAt: EXPIRES_AT,
      analysisSequence: 2,
      withContribution: true,
    })
    await lease.pool.query(
      `INSERT INTO ai_property_aggregate_contribution_mentions (
         organization_id, property_id, review_id, source_epoch, source_revision,
         analysis_sequence, mention_ordinal, topic, polarity, strength, thing,
         issue, names_person, issue_group_id
       ) VALUES ($1, $2, $3, $4, $5, $6, 0, 'facilities_equipment', 'negative',
                 'clear', 'air conditioning', 'noisy', null, $7)`,
      [
        key.organizationId,
        key.propertyId,
        key.reviewId,
        key.sourceEpoch,
        key.sourceRevision,
        key.analysisSequence,
        groupId,
      ],
    )

    await expect(
      lease.pool.query(`DELETE FROM ai_property_issue_groups WHERE id = $1`, [groupId]),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'ai_property_aggregate_contribution_mentions_issue_group_fk',
    })
  })

  it('removes groups, members and contribution mentions with the Property', async () => {
    const groupId = await insertGroup()
    await insertMember({ groupId })
    const key = await fixture.seedAnalysis({
      profile: 'review-analysis-v3',
      expiresAt: EXPIRES_AT,
      analysisSequence: 3,
      withContribution: true,
    })
    await lease.pool.query(
      `INSERT INTO ai_property_aggregate_contribution_mentions (
         organization_id, property_id, review_id, source_epoch, source_revision,
         analysis_sequence, mention_ordinal, topic, polarity, strength, thing,
         issue, names_person, issue_group_id
       ) VALUES ($1, $2, $3, $4, $5, $6, 0, 'facilities_equipment', 'negative',
                 'clear', 'air conditioning', 'noisy', null, $7)`,
      [
        key.organizationId,
        key.propertyId,
        key.reviewId,
        key.sourceEpoch,
        key.sourceRevision,
        key.analysisSequence,
        groupId,
      ],
    )

    await lease.pool.query(`DELETE FROM properties WHERE id = $1`, [PROPERTY_ID])

    for (const table of [
      'ai_property_issue_groups',
      'ai_property_issue_members',
      'ai_property_aggregate_contribution_mentions',
    ]) {
      const result = await lease.pool.query(
        `SELECT count(*)::int AS count FROM ${table} WHERE organization_id = $1`,
        [ORGANIZATION_ID],
      )
      expect(result.rows[0]?.count, table).toBe(0)
    }
    fixture = await installAiAnalysisFixture({
      db,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      now: NOW,
    })
  })
})
