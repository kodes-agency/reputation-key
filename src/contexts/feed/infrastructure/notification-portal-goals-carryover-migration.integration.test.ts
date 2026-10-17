// Migration 0063 against real PostgreSQL, on settings stored the way the
// "Goals" row stored them: everything under `recognition`. Inside one held
// transaction, always rolled back, the answers are seeded and 0063 is run on
// them statement by statement. The migration copies every row in its tables,
// so each test reads only its own people.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { createOneClickUnsubscribeRepository } from './repositories/one-click-unsubscribe.repository'

const DRIZZLE = join(import.meta.dirname, '..', '..', '..', '..', 'drizzle')

const STATEMENTS = readFileSync(
  join(DRIZZLE, '0063_notification_portal_goals_carryover.sql'),
  'utf8',
)
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0)

const ORG = 'org-notification-0063'
const USER = 'user-notification-0063'
const OTHER_USER = 'user-notification-0063-other'
const id = (n: number) => `63630000-0000-4000-8000-${String(n).padStart(12, '0')}`
const PROPERTY_A = id(1)
const PROPERTY_B = id(2)
const EMAIL_TARGET = id(10)
const DIGEST_TARGET = id(11)
const WORKFLOW_TARGET = id(12)
const STORED_AT = '2026-03-02T09:00:00.000Z'
const SCOPE_KEPT_AT = '2026-05-04T07:30:00.000Z'
const NOW = new Date('2026-10-17T12:00:00.000Z')

let held: HeldTransaction

async function runMigration(): Promise<void> {
  for (const statement of STATEMENTS) await held.client.query(statement)
}

type Answer = Readonly<{
  user?: string
  property?: string
  category: string
  channel: 'in_app' | 'email'
  enabled: boolean
  cadence?: 'immediate' | 'daily'
  maxRating?: number | null
}>

async function storePreference(answer: Answer): Promise<void> {
  await held.client.query(
    `INSERT INTO notification_preferences (user_id, organization_id, property_id,
       category, channel, enabled, cadence, max_rating, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
    [
      answer.user ?? USER,
      ORG,
      answer.property ?? PROPERTY_A,
      answer.category,
      answer.channel,
      answer.enabled,
      answer.cadence ?? 'daily',
      answer.maxRating ?? null,
      STORED_AT,
    ],
  )
}

async function storeDefault(answer: Answer): Promise<void> {
  await held.client.query(
    `INSERT INTO notification_category_defaults (user_id, organization_id, category,
       channel, enabled, cadence, max_rating, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [
      answer.user ?? USER,
      ORG,
      answer.category,
      answer.channel,
      answer.enabled,
      answer.cadence ?? 'daily',
      answer.maxRating ?? null,
      STORED_AT,
    ],
  )
}

async function keepScope(
  targetKind: 'email' | 'digest',
  targetId: string,
  property: string,
  category: string,
): Promise<void> {
  await held.client.query(
    `INSERT INTO notification_unsubscribe_scopes (target_kind, target_id,
       organization_id, user_id, property_id, category, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [targetKind, targetId, ORG, USER, property, category, SCOPE_KEPT_AT],
  )
}

type PreferenceRow = Readonly<{
  user_id: string
  property_id: string
  category: string
  channel: string
  enabled: boolean
  cadence: string
  max_rating: number | null
  fresh: boolean
}>

/** The fixture people's Property rows, `fresh` when this transaction wrote them. */
async function preferences(category?: string): Promise<readonly PreferenceRow[]> {
  const { rows } = await held.client.query<PreferenceRow>(
    `SELECT user_id, property_id::text AS property_id, category, channel, enabled,
            cadence, max_rating, created_at = now() AND updated_at = now() AS fresh
     FROM notification_preferences
     WHERE organization_id = $1 AND ($2::text IS NULL OR category = $2)
     ORDER BY user_id, property_id, category, channel`,
    [ORG, category ?? null],
  )
  return rows
}

type DefaultRow = Omit<PreferenceRow, 'property_id'>

async function defaults(category?: string): Promise<readonly DefaultRow[]> {
  const { rows } = await held.client.query<DefaultRow>(
    `SELECT user_id, category, channel, enabled, cadence, max_rating,
            created_at = now() AND updated_at = now() AS fresh
     FROM notification_category_defaults
     WHERE organization_id = $1 AND ($2::text IS NULL OR category = $2)
     ORDER BY user_id, category, channel`,
    [ORG, category ?? null],
  )
  return rows
}

type ScopeRow = Readonly<{
  target_kind: string
  target_id: string
  user_id: string
  property_id: string
  category: string
  created_at: Date
}>

async function scopes(category?: string): Promise<readonly ScopeRow[]> {
  const { rows } = await held.client.query<ScopeRow>(
    `SELECT target_kind, target_id::text AS target_id, user_id,
            property_id::text AS property_id, category, created_at
     FROM notification_unsubscribe_scopes
     WHERE organization_id = $1 AND ($2::text IS NULL OR category = $2)
     ORDER BY target_kind, target_id, property_id, category`,
    [ORG, category ?? null],
  )
  return rows
}

beforeEach(async () => {
  held = await holdTransaction()
  await held.client.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, now())
     ON CONFLICT (id) DO NOTHING`,
    [ORG],
  )
  for (const property of [PROPERTY_A, PROPERTY_B]) {
    await held.client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1::uuid, $2, $1::text, $1::text, 'Europe/Sofia')`,
      [property, ORG],
    )
  }
})

afterEach(async () => {
  await held.rollBack()
})

describe('migration 0063 on "Goals" answers stored before it', () => {
  it('copies every Goals answer per Property and as the default, both channels, on and off alike', async () => {
    await storePreference({ category: 'recognition', channel: 'in_app', enabled: false })
    await storePreference({ category: 'recognition', channel: 'email', enabled: true })
    // A goal email row saved as immediate before goal email became daily only.
    await storePreference({
      property: PROPERTY_B,
      category: 'recognition',
      channel: 'email',
      enabled: false,
      cadence: 'immediate',
    })
    await storePreference({
      user: OTHER_USER,
      category: 'recognition',
      channel: 'in_app',
      enabled: true,
    })
    await storeDefault({ category: 'recognition', channel: 'in_app', enabled: true })
    await storeDefault({ category: 'recognition', channel: 'email', enabled: false })

    await runMigration()

    const copy = { category: 'portal_goals', max_rating: null, fresh: true }
    expect(await preferences('portal_goals')).toEqual([
      {
        ...copy,
        user_id: USER,
        property_id: PROPERTY_A,
        channel: 'email',
        enabled: true,
        cadence: 'daily',
      },
      {
        ...copy,
        user_id: USER,
        property_id: PROPERTY_A,
        channel: 'in_app',
        enabled: false,
        cadence: 'daily',
      },
      {
        ...copy,
        user_id: USER,
        property_id: PROPERTY_B,
        channel: 'email',
        enabled: false,
        cadence: 'immediate',
      },
      {
        ...copy,
        user_id: OTHER_USER,
        property_id: PROPERTY_A,
        channel: 'in_app',
        enabled: true,
        cadence: 'daily',
      },
    ])
    expect(await defaults('portal_goals')).toEqual([
      { ...copy, user_id: USER, channel: 'email', enabled: false, cadence: 'daily' },
      { ...copy, user_id: USER, channel: 'in_app', enabled: true, cadence: 'daily' },
    ])
    // The Google rating goal keeps every answer it had.
    expect((await preferences('recognition')).map((row) => row.fresh)).toEqual([
      false,
      false,
      false,
      false,
    ])
    expect(await defaults('recognition')).toHaveLength(2)
  })

  it('keeps a Portal goals answer the person already has', async () => {
    await storePreference({ category: 'recognition', channel: 'in_app', enabled: false })
    await storePreference({ category: 'portal_goals', channel: 'in_app', enabled: true })
    await storeDefault({ category: 'recognition', channel: 'email', enabled: true })
    await storeDefault({ category: 'portal_goals', channel: 'email', enabled: false })

    await runMigration()

    expect(await preferences('portal_goals')).toEqual([
      expect.objectContaining({ channel: 'in_app', enabled: true, fresh: false }),
    ])
    expect(await defaults('portal_goals')).toEqual([
      expect.objectContaining({ channel: 'email', enabled: false, fresh: false }),
    ])
  })

  it('leaves other categories', async () => {
    await storePreference({
      category: 'workflow_collaboration',
      channel: 'email',
      enabled: false,
    })
    await storePreference({
      category: 'low_ratings',
      channel: 'in_app',
      enabled: true,
      cadence: 'immediate',
      maxRating: 3,
    })
    await storeDefault({ category: 'arrivals', channel: 'in_app', enabled: true })
    await keepScope('email', WORKFLOW_TARGET, PROPERTY_A, 'workflow_collaboration')
    const before = {
      preferences: await preferences(),
      defaults: await defaults(),
      scopes: await scopes(),
    }

    await runMigration()

    expect(await preferences()).toEqual(before.preferences)
    expect(await defaults()).toEqual(before.defaults)
    expect(await scopes()).toEqual(before.scopes)
  })

  it('copies unsubscribe scopes with their date', async () => {
    await keepScope('email', EMAIL_TARGET, PROPERTY_A, 'recognition')
    // A digest over two Properties offered "Goals" for both.
    await keepScope('digest', DIGEST_TARGET, PROPERTY_A, 'recognition')
    await keepScope('digest', DIGEST_TARGET, PROPERTY_B, 'recognition')
    await keepScope('digest', DIGEST_TARGET, PROPERTY_B, 'workflow_collaboration')

    await runMigration()

    const kept = {
      user_id: USER,
      category: 'portal_goals',
      created_at: new Date(SCOPE_KEPT_AT),
    }
    expect(await scopes('portal_goals')).toEqual([
      {
        ...kept,
        target_kind: 'digest',
        target_id: DIGEST_TARGET,
        property_id: PROPERTY_A,
      },
      {
        ...kept,
        target_kind: 'digest',
        target_id: DIGEST_TARGET,
        property_id: PROPERTY_B,
      },
      { ...kept, target_kind: 'email', target_id: EMAIL_TARGET, property_id: PROPERTY_A },
    ])
  })

  it('an old Goals unsubscribe link now stops both rows', async () => {
    // The person opted in to "Goals" email, then got one; its queue row has
    // since been swept, so only the kept scope says what the link offered.
    await storePreference({ category: 'recognition', channel: 'email', enabled: true })
    await keepScope('email', EMAIL_TARGET, PROPERTY_A, 'recognition')
    await runMigration()
    expect(await preferences('portal_goals')).toEqual([
      expect.objectContaining({ channel: 'email', enabled: true }),
    ])

    await createOneClickUnsubscribeRepository(held.db).apply(
      { kind: 'email', id: EMAIL_TARGET },
      NOW,
    )

    expect(
      (await preferences()).map(({ category, channel, enabled }) => ({
        category,
        channel,
        enabled,
      })),
    ).toEqual([
      { category: 'portal_goals', channel: 'email', enabled: false },
      { category: 'recognition', channel: 'email', enabled: false },
    ])
  })

  it('changes nothing the second time it runs', async () => {
    await storePreference({ category: 'recognition', channel: 'in_app', enabled: false })
    await storeDefault({ category: 'recognition', channel: 'email', enabled: true })
    await keepScope('email', EMAIL_TARGET, PROPERTY_A, 'recognition')

    await runMigration()
    const first = {
      preferences: await preferences(),
      defaults: await defaults(),
      scopes: await scopes(),
    }
    await runMigration()

    expect(await preferences()).toEqual(first.preferences)
    expect(await defaults()).toEqual(first.defaults)
    expect(await scopes()).toEqual(first.scopes)
    expect(first.preferences).toHaveLength(2)
  })
})
