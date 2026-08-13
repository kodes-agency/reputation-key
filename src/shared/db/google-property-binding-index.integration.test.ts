import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { getEnv } from '#/shared/config/env'
import {
  buildGooglePropertyBindingIndex,
  GOOGLE_PROPERTY_BINDING_INDEX,
  GOOGLE_PROPERTY_BINDING_INDEX_LOCK,
  inspectGooglePropertyBindingIndex,
} from '../../../scripts/google-property-binding-index'

const ORG_ID = 'google-binding-index-test-org'
const LOCATION_ID = 'canonical-location-safe'
const DUPLICATE_LOCATION_ID = 'duplicate-location-safe'

function propertyId(sequence: number): string {
  return `f6000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`
}

async function insertProperty(
  client: Client,
  input: Readonly<{
    sequence: number
    slug: string
    gbpLocationId?: string | null
    bindingState?: 'unbound' | 'account_confirmation_required'
  }>,
): Promise<void> {
  await client.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone,
       gbp_location_id, google_binding_state
     ) VALUES ($1, $2, $3, $4, 'Europe/Sofia', $5, $6)`,
    [
      propertyId(input.sequence),
      ORG_ID,
      `Index test ${input.sequence}`,
      input.slug,
      input.gbpLocationId ?? null,
      input.bindingState ?? 'unbound',
    ],
  )
}

describe('Google Property binding concurrent-index sidecar', () => {
  let builder: Client
  let contender: Client

  beforeAll(async () => {
    const url = getEnv().DATABASE_URL
    builder = new Client({ connectionString: url })
    contender = new Client({ connectionString: url })
    await Promise.all([builder.connect(), contender.connect()])
    await builder.query('DELETE FROM properties WHERE organization_id = $1', [ORG_ID])
  })

  afterAll(async () => {
    await contender
      .query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [
        GOOGLE_PROPERTY_BINDING_INDEX_LOCK,
      ])
      .catch(() => undefined)
    await builder.query('DELETE FROM properties WHERE organization_id = $1', [ORG_ID])
    await builder.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "${GOOGLE_PROPERTY_BINDING_INDEX}"`,
    )
    const restored = await buildGooglePropertyBindingIndex(builder)
    expect(restored.ok).toBe(true)
    await Promise.all([builder.end(), contender.end()])
  })

  it('builds and inspects exact canonical-location uniqueness', async () => {
    await builder.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "${GOOGLE_PROPERTY_BINDING_INDEX}"`,
    )
    await insertProperty(builder, {
      sequence: 1,
      slug: 'canonical-safe',
      gbpLocationId: LOCATION_ID,
      bindingState: 'account_confirmation_required',
    })

    const built = await buildGooglePropertyBindingIndex(builder)
    expect(built).toMatchObject({
      ok: true,
      code: 'created',
    })

    const rows = await builder.query<{
      slug: string
      gbp_location_id: string | null
      google_binding_state: string
    }>(
      `SELECT slug, gbp_location_id, google_binding_state
       FROM properties
       WHERE organization_id = $1
       ORDER BY slug`,
      [ORG_ID],
    )
    expect(rows.rows).toEqual([
      {
        slug: 'canonical-safe',
        gbp_location_id: LOCATION_ID,
        google_binding_state: 'account_confirmation_required',
      },
    ])
    await expect(inspectGooglePropertyBindingIndex(builder)).resolves.toMatchObject({
      ok: true,
      code: 'ready',
    })
  })

  it('reports duplicate counts without provider values and leaves the capability gate closed', async () => {
    await builder.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "${GOOGLE_PROPERTY_BINDING_INDEX}"`,
    )
    await insertProperty(builder, {
      sequence: 3,
      slug: 'duplicate-a',
      gbpLocationId: DUPLICATE_LOCATION_ID,
      bindingState: 'account_confirmation_required',
    })
    await insertProperty(builder, {
      sequence: 4,
      slug: 'duplicate-b',
      gbpLocationId: DUPLICATE_LOCATION_ID,
      bindingState: 'account_confirmation_required',
    })

    const denied = await buildGooglePropertyBindingIndex(builder)
    expect(denied).toMatchObject({
      ok: false,
      code: 'duplicates_found',
      duplicateGroups: 1,
      duplicateRows: 2,
    })
    expect(JSON.stringify(denied)).not.toContain(DUPLICATE_LOCATION_ID)
    await expect(inspectGooglePropertyBindingIndex(builder)).resolves.toMatchObject({
      ok: false,
      code: 'duplicates_found',
    })

    await builder.query(
      'DELETE FROM properties WHERE organization_id = $1 AND gbp_location_id = $2',
      [ORG_ID, DUPLICATE_LOCATION_ID],
    )
    expect((await buildGooglePropertyBindingIndex(builder)).ok).toBe(true)
  })

  it('fails closed under lock contention and replaces a wrong prior definition', async () => {
    await contender.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [
      GOOGLE_PROPERTY_BINDING_INDEX_LOCK,
    ])
    await expect(buildGooglePropertyBindingIndex(builder)).resolves.toMatchObject({
      ok: false,
      code: 'advisory_lock_busy',
    })
    await contender.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [
      GOOGLE_PROPERTY_BINDING_INDEX_LOCK,
    ])

    await builder.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "${GOOGLE_PROPERTY_BINDING_INDEX}"`,
    )
    await builder.query(
      `CREATE INDEX "${GOOGLE_PROPERTY_BINDING_INDEX}" ON properties (organization_id)`,
    )
    await expect(buildGooglePropertyBindingIndex(builder)).resolves.toMatchObject({
      ok: true,
      code: 'recreated',
    })
    await expect(inspectGooglePropertyBindingIndex(builder)).resolves.toMatchObject({
      ok: true,
      code: 'ready',
    })
  })
})
