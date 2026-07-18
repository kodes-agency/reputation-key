// BQC-4.2 — property routing loader adapter (real PostgreSQL).
//
// The adapter is the production binding of the ProcessingRouter's
// loadPropertyRouting port: an identifier-only select of the property's
// persisted routing facts (migration 0006: processing_region +
// routing_policy_version). Null for a missing property → the router blocks
// with property_missing (fail closed, ADR 0048).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { createProcessingRouter } from '#/shared/routing/processing-router'
import { createPropertyRoutingLoader } from '../property-routing.adapter'

const db = getDb()
const ORG = 'org-routing-adapter'
const MISSING_ID = '00000000-0000-0000-0000-0000000000ff'

let propUs: string
let propUnresolved: string

async function insertProperty(slug: string): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO properties (organization_id, name, slug, timezone)
    VALUES (${ORG}, ${slug}, ${slug}, 'UTC')
    RETURNING id
  `)
  return (rows.rows[0] as { id: string }).id
}

beforeAll(async () => {
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Routing Adapter', ${ORG}, now())
  `)

  // Approved cell: region resolved to 'us', policy version bumped by a
  // resolution change (ADR 0048 — every resolution change bumps the version).
  propUs = await insertProperty('routing-us')
  await db.execute(sql`
    UPDATE properties
    SET processing_region = 'us', processing_region_source = 'country_default',
        routing_policy_version = 2, processing_region_resolved_at = now(),
        country_code = 'US', country_source = 'google_address'
    WHERE id = ${propUs}
  `)

  // Default insert state: unresolved region, policy version 1.
  propUnresolved = await insertProperty('routing-unresolved')
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
})

describe('createPropertyRoutingLoader (BQC-4.2)', () => {
  const loadPropertyRouting = createPropertyRoutingLoader({ db })

  it('loads processing_region + routing_policy_version for a resolved property', async () => {
    const record = await loadPropertyRouting(propUs)

    expect(record).toEqual({ processingRegion: 'us', routingPolicyVersion: 2 })
  })

  it('loads the unresolved default state for an unreconciled property', async () => {
    const record = await loadPropertyRouting(propUnresolved)

    expect(record).toEqual({
      processingRegion: 'unresolved',
      routingPolicyVersion: 1,
    })
  })

  it('returns null for a missing property', async () => {
    expect(await loadPropertyRouting(MISSING_ID)).toBeNull()
  })
})

describe('ProcessingRouter over the production adapter (BQC-4.2)', () => {
  const router = createProcessingRouter({
    loadPropertyRouting: createPropertyRoutingLoader({ db }),
    cell: 'us',
  })

  it('resolves the us property to the us cell target', async () => {
    const decision = await router.resolve(propUs, 'review.sync')

    expect(decision).toEqual({
      kind: 'target',
      cell: 'us',
      region: 'us',
      queue: 'default',
      provider: 'gbp-default',
      routingPolicyVersion: 2,
    })
  })

  it('fails closed for the unresolved property', async () => {
    const decision = await router.resolve(propUnresolved, 'reply.publish')

    expect(decision).toEqual({
      kind: 'blocked',
      reason: 'region_unresolved',
      region: 'unresolved',
    })
  })

  it('fails closed for a missing property', async () => {
    const decision = await router.resolve(MISSING_ID, 'review.sync')

    expect(decision).toEqual({
      kind: 'blocked',
      reason: 'property_missing',
      region: null,
    })
  })
})
