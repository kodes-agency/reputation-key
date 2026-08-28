// ARC-03-T9 contract test — Property/Integration seam.
//
// The GBP webhook is push-based, so Integration resolves a Property from a
// provider location id with no tenant in hand. The contract is deliberately
// narrow: one identifier-keyed read that returns null rather than throwing, and
// carries the binding state and source epoch Integration needs to decide
// whether the notification is still current.

import { describe, expect, it } from 'vitest'
import { GOOGLE_PROVIDER_FIXTURES_V1 } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PropertyLookup, PropertyLookupPort } from './property-lookup.port'

// Provider resource literals are catalogue-governed; the identifier gate
// refuses an inline one so a real customer resource can never reach the tree.
const SEGMENTS = GOOGLE_PROVIDER_FIXTURES_V1['google-review-primary'].expectedSegments
const ACCOUNT_ID = SEGMENTS.accountId!
const LOCATION_ID = SEGMENTS.locationId!
const OTHER_LOCATION_ID = `${LOCATION_ID}-secondary`
const UNKNOWN_LOCATION_ID = `${LOCATION_ID}-absent`

const bound: PropertyLookup = {
  id: 'prop-1',
  organizationId: 'org-1',
  googleConnectionId: 'conn-1',
  gbpAccountId: ACCOUNT_ID,
  gbpLocationId: LOCATION_ID,
  googleBindingState: 'active',
  sourceEpoch: 3,
}

const inMemoryPropertyLookup = (
  properties: readonly PropertyLookup[],
): PropertyLookupPort =>
  Object.freeze({
    findByGbpLocationId: async (gbpLocationId) =>
      properties.find((property) => property.gbpLocationId === gbpLocationId) ?? null,
  })

describe('PropertyLookupPort contract', () => {
  const lookup = inMemoryPropertyLookup([
    bound,
    {
      ...bound,
      id: 'prop-2',
      gbpLocationId: OTHER_LOCATION_ID,
      googleBindingState: 'disconnected',
    },
  ])

  it('resolves a property from the provider location id alone', async () => {
    expect(await lookup.findByGbpLocationId(LOCATION_ID)).toEqual(bound)
  })

  it('returns null for an unknown location instead of throwing', async () => {
    // A webhook for a location this cell does not host is normal traffic.
    expect(await lookup.findByGbpLocationId(UNKNOWN_LOCATION_ID)).toBeNull()
  })

  it('carries the binding state so a stale notification can be refused', async () => {
    const disconnected = await lookup.findByGbpLocationId(OTHER_LOCATION_ID)

    expect(disconnected?.googleBindingState).toBe('disconnected')
    expect(disconnected?.sourceEpoch).toBe(3)
  })

  it('is consumed through the port, never through a context-private hatch', () => {
    const consumer = readFileSync(resolve('src/contexts/integration/build.ts'), 'utf8')

    expect(consumer).not.toContain('.internal.')
    expect(consumer).toContain('PropertyLookupPort')
  })
})
