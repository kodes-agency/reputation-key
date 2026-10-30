import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  type AiAnalysisFixture,
  type AiAnalysisKey,
  installAiAnalysisFixture,
} from '#/shared/db/testing/ai-review-analysis-v3-fixture'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createAiIssueGroupStoreAdapter } from './ai-issue-group-store.adapter'
import { assignContributionIssueGroups } from './ai-issue-group-assignment'

const ORGANIZATION_ID = 'ai-issue-store-test-org'
const PROPERTY_ID = '7a380000-0000-4000-8000-000000000001'
const NOW = new Date('2026-10-30T09:00:00.000Z')
const EXPIRES_AT = new Date('2028-10-29T09:00:00.000Z')
const SCOPE = { organizationId: ORGANIZATION_ID, propertyId: PROPERTY_ID }

let lease: TestLease
let db: Database
let fixture: AiAnalysisFixture
let store: ReturnType<typeof createAiIssueGroupStoreAdapter>
let sequence = 0

async function group(
  canonicalKey: string,
  topic = 'facilities_equipment',
  expiresAt = EXPIRES_AT,
): Promise<string> {
  const id = randomUUID()
  await lease.pool.query(
    `INSERT INTO ai_property_issue_groups (
       id, organization_id, property_id, topic, canonical_thing, canonical_key,
       created_at, updated_at, last_seen_at, expires_at, normalization_version
     ) VALUES ($1, $2, $3, $4, $5, $5, $6, $6, $6, $7,
               'property-issue-normalization-v1')`,
    [id, ORGANIZATION_ID, PROPERTY_ID, topic, canonicalKey, NOW, expiresAt],
  )
  return id
}

async function member(groupId: string, key: string): Promise<void> {
  await lease.pool.query(
    `INSERT INTO ai_property_issue_members (
       issue_group_id, organization_id, property_id, topic, member_key,
       member_thing, source, created_at, last_seen_at
     ) VALUES ($1, $2, $3, 'facilities_equipment', $4, $4,
               'deterministic', $5, $5)`,
    [groupId, ORGANIZATION_ID, PROPERTY_ID, key, NOW],
  )
}

async function contributionMention(
  thing: string,
  issueGroupId: string | null,
): Promise<AiAnalysisKey> {
  sequence += 1
  const key = await fixture.seedAnalysis({
    profile: 'review-analysis-v3',
    expiresAt: EXPIRES_AT,
    analysisSequence: sequence,
    withContribution: true,
  })
  await lease.pool.query(
    `INSERT INTO ai_property_aggregate_contribution_mentions (
       organization_id, property_id, review_id, source_epoch, source_revision,
       analysis_sequence, mention_ordinal, topic, polarity, strength, thing,
       issue, names_person, issue_group_id
     ) VALUES ($1, $2, $3, $4, $5, $6, 0, 'facilities_equipment', 'negative',
               'clear', $7, 'noisy', null, $8)`,
    [
      key.organizationId,
      key.propertyId,
      key.reviewId,
      key.sourceEpoch,
      key.sourceRevision,
      key.analysisSequence,
      thing,
      issueGroupId,
    ],
  )
  return key
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL)
  db = drizzle(lease.pool)
  fixture = await installAiAnalysisFixture({
    db,
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    now: NOW,
  })
  store = createAiIssueGroupStoreAdapter(db)
})

beforeEach(async () => fixture.reset())

afterAll(async () => {
  await fixture.remove()
  await lease.release()
})

describe.sequential('AI issue group store adapter', () => {
  it('renames, hides and shows only the scoped surviving group', async () => {
    const issueId = await group('air conditioning')

    const renamed = await store.rename(SCOPE, issueId, 'Cooling system', NOW)
    const hidden = await store.setHidden(
      SCOPE,
      issueId,
      { at: NOW, by: 'manager-adapter' },
      NOW,
    )
    const hiddenAgain = await store.setHidden(
      SCOPE,
      issueId,
      { at: NOW, by: 'manager-other' },
      NOW,
    )
    const shown = await store.setHidden(SCOPE, issueId, null, NOW)

    expect(renamed).toMatchObject({
      status: 'applied',
      issue: { displayName: 'Cooling system' },
    })
    expect(hidden).toMatchObject({ status: 'applied', changed: true })
    expect(hiddenAgain).toMatchObject({ status: 'applied', changed: false })
    expect(shown).toMatchObject({ status: 'applied', changed: true })
  })

  it('merges members and contribution references, flattens redirects and raises expiry', async () => {
    const later = new Date('2029-01-01T00:00:00.000Z')
    const source = await group('air conditioning', 'facilities_equipment', later)
    const target = await group('cooling unit')
    const redirect = await group('ac unit')
    await member(source, 'air conditioning')
    await lease.pool.query(
      `UPDATE ai_property_issue_groups SET merged_into_issue_id = $1 WHERE id = $2`,
      [source, redirect],
    )
    const key = await contributionMention('air conditioning', source)

    const result = await store.merge(SCOPE, source, target, NOW)

    expect(result).toMatchObject({
      status: 'applied',
      sourceIssueId: source,
      issue: { id: target, expiresAt: later },
    })
    const state = await lease.pool.query(
      `SELECT
         (SELECT issue_group_id FROM ai_property_issue_members WHERE member_key = 'air conditioning') AS member_group,
         (SELECT issue_group_id FROM ai_property_aggregate_contribution_mentions WHERE review_id = $1) AS mention_group,
         (SELECT merged_into_issue_id FROM ai_property_issue_groups WHERE id = $2) AS redirect_target`,
      [key.reviewId, redirect],
    )
    expect(state.rows[0]).toEqual({
      member_group: target,
      mention_group: target,
      redirect_target: target,
    })
  })

  it('resolves old ids and refuses cross-topic, same-target and cross-tenant inputs', async () => {
    const source = await group('air conditioning')
    const target = await group('cooling unit')
    const otherTopic = await group('bathroom', 'cleanliness')
    await store.merge(SCOPE, source, target, NOW)

    await expect(store.resolve(SCOPE, source)).resolves.toMatchObject({
      status: 'found',
      issue: { id: target },
      redirectedFromIssueId: source,
    })
    await expect(store.merge(SCOPE, source, target, NOW)).resolves.toEqual({
      status: 'same_issue',
    })
    await expect(store.merge(SCOPE, target, otherTopic, NOW)).resolves.toEqual({
      status: 'cross_topic',
    })
    await expect(
      store.resolve({ ...SCOPE, organizationId: 'another-org' }, target),
    ).resolves.toEqual({ status: 'not_found' })
  })

  it('has a database backstop against cross-topic redirects', async () => {
    const source = await group('air conditioning')
    const otherTopic = await group('bathroom', 'cleanliness')

    await expect(
      lease.pool.query(
        `UPDATE ai_property_issue_groups SET merged_into_issue_id = $1
         WHERE organization_id = $2 AND property_id = $3 AND id = $4`,
        [otherTopic, ORGANIZATION_ID, PROPERTY_ID, source],
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'ai_property_issue_groups_merged_into_fk',
    })
  })

  it('serializes two merges with an assignment and leaves every path at one target', async () => {
    const first = await group('air conditioning')
    const second = await group('air conditioner')
    const target = await group('cooling unit')
    await member(first, 'air conditioning')
    await member(second, 'air conditioner')
    const key = await contributionMention('air con', null)

    await Promise.all([
      store.merge(SCOPE, first, target, NOW),
      store.merge(SCOPE, second, target, NOW),
      db.transaction(async (tx) => {
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${ORGANIZATION_ID} || ':' || ${PROPERTY_ID}::text, 0)
          )
        `)
        await assignContributionIssueGroups(tx, key, EXPIRES_AT, NOW)
      }),
    ])

    const row = await lease.pool.query(
      `SELECT issue_group_id FROM ai_property_aggregate_contribution_mentions
       WHERE organization_id = $1 AND review_id = $2`,
      [ORGANIZATION_ID, key.reviewId],
    )
    expect(row.rows[0]?.issue_group_id).toBe(target)
    await expect(store.resolve(SCOPE, first)).resolves.toMatchObject({
      status: 'found',
      issue: { id: target },
    })
    await expect(store.resolve(SCOPE, second)).resolves.toMatchObject({
      status: 'found',
      issue: { id: target },
    })
  })

  it('routes a new member matching a merged loser canonical key to the target', async () => {
    const source = await group('air conditioning')
    const target = await group('cooling unit')
    await store.merge(SCOPE, source, target, NOW)
    const key = await contributionMention('ac', null)

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${ORGANIZATION_ID} || ':' || ${PROPERTY_ID}::text, 0)
        )
      `)
      await assignContributionIssueGroups(tx, key, EXPIRES_AT, NOW)
    })

    const row = await lease.pool.query(
      `SELECT issue_group_id FROM ai_property_aggregate_contribution_mentions
       WHERE organization_id = $1 AND review_id = $2`,
      [ORGANIZATION_ID, key.reviewId],
    )
    expect(row.rows[0]?.issue_group_id).toBe(target)
  })
})
