// The push health and reconciliation-age reads against REAL PostgreSQL.
//
// The unit suite proves the rules (push-health.test.ts); these prove the SQL:
// which first sightings count, that only Properties the sweep still polls are
// judged, how an account is grouped, and how a reconciliation's age is taken.
//
// The scratch database is shared, so every assertion is a DELTA over a
// pre-seed baseline (or a lower bound for an age). Seeded rows carry
// suite-unique markers and are deleted after each test; the integration
// project runs serially.

import { afterEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { readSyncPushHealth } from '#/shared/db/sync-push-health'

const ORG = 'org-obs-sync-push'
const CONNECTION = '5a6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e70'
const INACTIVE_CONNECTION = '5a6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e71'
const PROPERTY_PREFIX = '5a6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5f'
const ACCOUNT_ONE = 'push-health-account-one'
const ACCOUNT_TWO = 'push-health-account-two'
const MINUTE = 1
const HOUR = 60
const DAY = 24 * HOUR
/** A Property or connection nobody has touched for a month: settled. */
const SETTLED = 30 * DAY

const db = getDb()

afterEach(async () => {
  await db.execute(
    sql`DELETE FROM idempotency_receipts WHERE scope = 'gbp_webhook' AND key LIKE 'obs-sync-push-%'`,
  )
  await db.execute(
    sql`DELETE FROM review_sync_state WHERE property_id LIKE ${`${PROPERTY_PREFIX}%`}`,
  )
  await db.execute(
    sql`DELETE FROM review_google_reputation_snapshot_facts WHERE organization_id = ${ORG}`,
  )
  // Deleting the Property cascades its first-sighting rows.
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM google_connections WHERE organization_id = ${ORG}`)
})

async function seedConnection(id: string, status: string) {
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Sync push Org', 't-obs-sync-push', NOW())
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO google_connections
      (id, organization_id, google_subject, encrypted_access_token,
       encrypted_refresh_token, token_expires_at, scopes, connected_by,
       credential_authorized_at, visibility, status, credential_use_state,
       created_at, updated_at)
    VALUES (${id}, ${ORG}, ${`subject-${id}`}, 'enc-a', 'enc-r',
            NOW() + INTERVAL '1 day',
            ARRAY['https://www.googleapis.com/auth/business.manage'],
            'seed-user', NOW() - (${SETTLED} * INTERVAL '1 minute'),
            'organization', ${status}, 'active', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `)
}

type SeedProperty = Readonly<{
  /** Two hex digits, appended to the suite's Property id prefix. */
  suffix: string
  account?: string
  sourceEpoch?: number
  lifecycleState?: string
  connectionId?: string
  /** When an administrator last changed the Property (it qualified from then). */
  updatedMinutesAgo?: number
}>

async function seedProperty(property: SeedProperty): Promise<string> {
  const id = `${PROPERTY_PREFIX}${property.suffix}`
  await seedConnection(CONNECTION, 'active')
  await seedConnection(INACTIVE_CONNECTION, 'reauth_required')
  await db.execute(sql`
    INSERT INTO properties
      (id, organization_id, name, slug, timezone, google_connection_id,
       gbp_account_id, gbp_location_id, google_binding_state, lifecycle_state,
       source_epoch, created_at, updated_at)
    VALUES (${id}, ${ORG}, ${`Push ${property.suffix}`},
            ${`obs-sync-push-${property.suffix}`}, 'UTC',
            ${property.connectionId ?? CONNECTION},
            ${property.account ?? ACCOUNT_ONE},
            ${`push-health-location-${property.suffix}`},
            'active', ${property.lifecycleState ?? 'active'},
            ${property.sourceEpoch ?? 0}, NOW(),
            NOW() - (${property.updatedMinutesAgo ?? SETTLED} * INTERVAL '1 minute'))
  `)
  return id
}

type SeedSighting = Readonly<{
  via: 'push' | 'push_reconcile' | 'snapshot' | 'head' | 'demand'
  seenMinutesAgo: number
  /** Minutes after the first sighting that Pub/Sub accepted the push. */
  pushAfterMinutes?: number
  pushBeforeMinutes?: number
  /** Stores the Review too, with the date Google gave it, this long before now. */
  writtenMinutesAgo?: number
}>

async function seedReview(propertyId: string, writtenMinutesAgo: number) {
  const id = crypto.randomUUID()
  await db.execute(sql`
    INSERT INTO reviews
      (id, organization_id, property_id, platform, external_id, reviewer_name, rating,
       text, language_code, reviewed_at, source_created_at, content_expires_at,
       source_epoch, source_revision, analysis_sequence, ai_source_byte_length,
       ai_source_digest)
    VALUES (${id}, ${ORG}, ${propertyId}, 'google', ${`obs-sync-push-${id}`},
            'Synthetic reviewer', 2, 'Synthetic review', 'en',
            NOW() - (${writtenMinutesAgo} * INTERVAL '1 minute'),
            NOW() - (${writtenMinutesAgo} * INTERVAL '1 minute'),
            NOW() + INTERVAL '30 days', 0, 1, 1, 16, ${'a'.repeat(64)})
  `)
  return id
}

async function seedSighting(propertyId: string, sighting: SeedSighting) {
  const accepted =
    sighting.pushAfterMinutes !== undefined
      ? sql`NOW() - (${sighting.seenMinutesAgo - sighting.pushAfterMinutes} * INTERVAL '1 minute')`
      : sighting.pushBeforeMinutes !== undefined
        ? sql`NOW() - (${sighting.seenMinutesAgo + sighting.pushBeforeMinutes} * INTERVAL '1 minute')`
        : sql`NULL`
  const reviewId =
    sighting.writtenMinutesAgo !== undefined
      ? await seedReview(propertyId, sighting.writtenMinutesAgo)
      : crypto.randomUUID()
  await db.execute(sql`
    INSERT INTO review_first_sightings
      (organization_id, property_id, review_id, source_epoch, first_seen_at,
       first_seen_via, push_accepted_at)
    VALUES (${ORG}, ${propertyId}, ${reviewId}, 0,
            NOW() - (${sighting.seenMinutesAgo} * INTERVAL '1 minute'),
            ${sighting.via}, ${accepted})
  `)
}

async function seedReceipt(label: string, outcome: string) {
  await db.execute(sql`
    INSERT INTO idempotency_receipts (scope, key, payload, recorded_at)
    VALUES ('gbp_webhook', ${`obs-sync-push-${label}`},
            ${JSON.stringify({ outcome })}::jsonb, NOW())
  `)
}

async function seedFact(
  propertyId: string,
  sourceEpoch: number,
  evaluatedMinutesAgo: number,
  listingComplete = true,
) {
  await db.execute(sql`
    INSERT INTO review_google_reputation_snapshot_facts
      (run_id, event_id, organization_id, property_id, source_epoch, review_count,
       average_rating, evaluated_at, listing_complete)
    VALUES (${crypto.randomUUID()}, ${crypto.randomUUID()}, ${ORG}, ${propertyId},
            ${sourceEpoch}, 0, NULL,
            NOW() - (${evaluatedMinutesAgo} * INTERVAL '1 minute'), ${listingComplete})
  `)
}

async function seedSyncState(propertyId: string, errorClass: string | null) {
  await db.execute(sql`
    INSERT INTO review_sync_state (property_id, source, error_class, updated_at)
    VALUES (${propertyId}, 'google', ${errorClass}, NOW())
  `)
}

const read = (pushEnabled = true) => readSyncPushHealth(db, pushEnabled)

describe('push health read (real reads)', () => {
  it('counts the last day by how each Review was first seen and by push outcome', async () => {
    const baseline = (await read()).push
    const property = await seedProperty({ suffix: '01' })
    await seedSighting(property, { via: 'push', seenMinutesAgo: 2 * HOUR })
    await seedSighting(property, { via: 'push_reconcile', seenMinutesAgo: 2 * HOUR })
    await seedSighting(property, {
      via: 'snapshot',
      seenMinutesAgo: 3 * HOUR,
      pushAfterMinutes: 10,
    })
    await seedSighting(property, { via: 'snapshot', seenMinutesAgo: 3 * HOUR })
    await seedSighting(property, { via: 'snapshot', seenMinutesAgo: 10 * MINUTE })
    await seedSighting(property, { via: 'snapshot', seenMinutesAgo: 2 * DAY })

    const after = (await read()).push

    expect(after.newByPush24h).toBe(baseline.newByPush24h + 2)
    expect(after.newByPoll24h).toBe(baseline.newByPoll24h + 3)
    expect(after.late24h).toBe(baseline.late24h + 1)
    expect(after.missed24h).toBe(baseline.missed24h + 1)
    expect(after.pending).toBe(baseline.pending + 1)
  })

  it('treats a push accepted before polling saw the Review as healthy', async () => {
    const baseline = (await read()).push
    const property = await seedProperty({ suffix: '02' })
    await seedSighting(property, {
      via: 'snapshot',
      seenMinutesAgo: 3 * HOUR,
      pushBeforeMinutes: 1,
    })

    const after = (await read()).push

    expect(after.missed24h).toBe(baseline.missed24h)
    expect(after.late24h).toBe(baseline.late24h)
    expect(after.newByPoll24h).toBe(baseline.newByPoll24h + 1)
  })

  it('counts a push that came after the window as late and still missed', async () => {
    const baseline = (await read()).push
    const property = await seedProperty({ suffix: '03' })
    await seedSighting(property, {
      via: 'snapshot',
      seenMinutesAgo: 5 * HOUR,
      pushAfterMinutes: 90,
    })

    const after = (await read()).push

    expect(after.late24h).toBe(baseline.late24h + 1)
    expect(after.missed24h).toBe(baseline.missed24h + 1)
  })

  it('does not hold a push against a Review Google published days after it was written', async () => {
    const baseline = (await read()).push
    const property = await seedProperty({ suffix: '0a' })
    await seedSighting(property, {
      via: 'snapshot',
      seenMinutesAgo: 2 * HOUR,
      writtenMinutesAgo: 7 * DAY,
    })

    const after = (await read()).push

    expect(after.missed24h).toBe(baseline.missed24h)
    expect(after.newByPoll24h).toBe(baseline.newByPoll24h)
    expect(after.locationsSuspect).toBe(baseline.locationsSuspect)
  })

  it('still holds a missing push against a Review Google dates just before polling saw it', async () => {
    const baseline = (await read()).push
    const property = await seedProperty({ suffix: '0b' })
    await seedSighting(property, {
      via: 'snapshot',
      seenMinutesAgo: 2 * HOUR,
      writtenMinutesAgo: 2 * HOUR + 10,
    })

    const after = (await read()).push

    expect(after.missed24h).toBe(baseline.missed24h + 1)
    expect(after.newByPoll24h).toBe(baseline.newByPoll24h + 1)
    expect(after.locationsSuspect).toBe(baseline.locationsSuspect + 1)
  })

  it('makes a location suspect after one miss in a week and an account dark after two across it', async () => {
    const baseline = (await read()).push
    const silentOne = await seedProperty({ suffix: '04', account: ACCOUNT_ONE })
    const silentTwo = await seedProperty({ suffix: '05', account: ACCOUNT_ONE })
    const quiet = await seedProperty({ suffix: '06', account: ACCOUNT_ONE })
    const lone = await seedProperty({ suffix: '07', account: ACCOUNT_TWO })
    await seedSighting(silentOne, { via: 'snapshot', seenMinutesAgo: 3 * DAY })
    await seedSighting(silentTwo, { via: 'snapshot', seenMinutesAgo: 5 * DAY })
    await seedSighting(quiet, { via: 'push', seenMinutesAgo: 3 * DAY })
    await seedSighting(lone, { via: 'snapshot', seenMinutesAgo: 4 * DAY })

    const after = (await read()).push

    // 3 suspect (04, 05, 07); 1 healthy (06); account one (04 + 05) is dark.
    expect(after.locationsSuspect).toBe(baseline.locationsSuspect + 3)
    expect(after.locationsHealthy).toBe(baseline.locationsHealthy + 1)
    expect(after.accountsDark).toBe(baseline.accountsDark + 1)
  })

  it('does not group two Google accounts of one Organization into one dark account', async () => {
    const baseline = (await read()).push
    const one = await seedProperty({ suffix: '08', account: ACCOUNT_ONE })
    const two = await seedProperty({ suffix: '09', account: ACCOUNT_TWO })
    await seedSighting(one, { via: 'snapshot', seenMinutesAgo: 3 * DAY })
    await seedSighting(two, { via: 'snapshot', seenMinutesAgo: 3 * DAY })

    expect((await read()).push.accountsDark).toBe(baseline.accountsDark)
  })

  it('judges only Properties the discovery sweep still polls', async () => {
    const baseline = (await read()).push
    const archived = await seedProperty({ suffix: '0a', lifecycleState: 'archived' })
    const unauthorized = await seedProperty({
      suffix: '0b',
      connectionId: INACTIVE_CONNECTION,
    })
    await seedSighting(archived, { via: 'snapshot', seenMinutesAgo: 3 * HOUR })
    await seedSighting(unauthorized, { via: 'snapshot', seenMinutesAgo: 3 * HOUR })

    expect((await read()).push).toEqual(baseline)
  })

  it('counts the pushes Pub/Sub accepted in the last day, not the ones it ignored', async () => {
    const baseline = (await read()).push
    await seedReceipt('targeted', 'accepted_targeted')
    await seedReceipt('reconciliation', 'accepted_reconciliation')
    await seedReceipt('unknown-location', 'ignored_property_not_found')
    await seedReceipt('mismatch', 'ignored_binding_mismatch')

    expect((await read()).push.acceptedPushes24h).toBe(baseline.acceptedPushes24h + 2)
  })

  it('reports no push health while push is not configured', async () => {
    const property = await seedProperty({ suffix: '0c' })
    await seedSighting(property, { via: 'snapshot', seenMinutesAgo: 3 * HOUR })
    await seedReceipt('configured-off', 'accepted_targeted')

    expect((await read(false)).push).toEqual({
      newByPush24h: 0,
      newByPoll24h: 0,
      pending: 0,
      missed24h: 0,
      late24h: 0,
      acceptedPushes24h: 0,
      locationsHealthy: 0,
      locationsSuspect: 0,
      accountsDark: 0,
    })
  })
})

describe('reconciliation age read (real reads)', () => {
  it('counts a Property whose newest completed reconciliation is older than eight hours', async () => {
    const baseline = (await read()).reconciliation
    const fresh = await seedProperty({ suffix: '11' })
    const stale = await seedProperty({ suffix: '12' })
    await seedFact(fresh, 0, 1 * HOUR)
    await seedFact(stale, 0, 9 * HOUR)
    await seedFact(stale, 0, 20 * HOUR)

    const after = (await read()).reconciliation

    expect(after.overdueCount).toBe(baseline.overdueCount + 1)
    expect(after.oldestAgeMs).toBeGreaterThanOrEqual(9 * HOUR * 60_000)
  })

  it('does not let a head fact reset the age: Google’s numbers from one read prove no completed listing', async () => {
    const baseline = (await read()).reconciliation
    const property = await seedProperty({ suffix: '1c' })
    await seedFact(property, 0, 9 * HOUR)
    await seedFact(property, 0, 5 * MINUTE, false)

    const after = (await read()).reconciliation

    expect(after.overdueCount).toBe(baseline.overdueCount + 1)
    expect(after.oldestAgeMs).toBeGreaterThanOrEqual(9 * HOUR * 60_000)
  })

  it('counts a Property with no reconciliation from the day it became syncable', async () => {
    const baseline = (await read()).reconciliation
    await seedProperty({ suffix: '13', updatedMinutesAgo: 10 * HOUR })
    await seedProperty({ suffix: '14', updatedMinutesAgo: 1 * HOUR })

    expect((await read()).reconciliation.overdueCount).toBe(baseline.overdueCount + 1)
  })

  it('ignores a reconciliation of an older source epoch', async () => {
    const baseline = (await read()).reconciliation
    const relinked = await seedProperty({
      suffix: '15',
      sourceEpoch: 1,
      updatedMinutesAgo: 10 * HOUR,
    })
    await seedFact(relinked, 0, 10 * MINUTE)

    expect((await read()).reconciliation.overdueCount).toBe(baseline.overdueCount + 1)
  })

  it('measures a restored Property from when it qualified again, not from its old reconciliation', async () => {
    const baseline = (await read()).reconciliation
    const restored = await seedProperty({ suffix: '16', updatedMinutesAgo: 30 * MINUTE })
    await seedFact(restored, 0, 3 * DAY)

    expect((await read()).reconciliation.overdueCount).toBe(baseline.overdueCount)
  })

  it('leaves a Property parked with a coded failure to that failure alert', async () => {
    const baseline = (await read()).reconciliation
    const parked = await seedProperty({ suffix: '17' })
    await seedFact(parked, 0, 20 * HOUR)
    await seedSyncState(parked, 'review_cap_exceeded')

    expect((await read()).reconciliation.overdueCount).toBe(baseline.overdueCount)
  })

  it('judges a Property whose sync state row has no failure like one with no row', async () => {
    const baseline = (await read()).reconciliation
    const property = await seedProperty({ suffix: '18' })
    await seedFact(property, 0, 20 * HOUR)
    await seedSyncState(property, null)

    expect((await read()).reconciliation.overdueCount).toBe(baseline.overdueCount + 1)
  })

  it('ignores Properties the sweep no longer polls', async () => {
    const baseline = (await read()).reconciliation
    const archived = await seedProperty({ suffix: '19', lifecycleState: 'archived' })
    const unauthorized = await seedProperty({
      suffix: '1a',
      connectionId: INACTIVE_CONNECTION,
    })
    await seedFact(archived, 0, 20 * HOUR)
    await seedFact(unauthorized, 0, 20 * HOUR)

    expect((await read()).reconciliation.overdueCount).toBe(baseline.overdueCount)
  })

  it('still reports reconciliation age while push is not configured', async () => {
    const baseline = (await read(false)).reconciliation
    const stale = await seedProperty({ suffix: '1b' })
    await seedFact(stale, 0, 12 * HOUR)

    expect((await read(false)).reconciliation.overdueCount).toBe(
      baseline.overdueCount + 1,
    )
  })
})
