// Seeds for the Property server-function integration tests: a Property that is
// bound to Google, and the check that no answer carries that Google identity.

import { expect } from 'vitest'
import { getDb } from '#/shared/db'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import { buildTestProperty } from '#/shared/testing/fixtures'
import { seedGoogleConnection } from '#/shared/testing/google-connection-seed'
import type {
  ServerFunctionHarness,
  TestOrganization,
  TestProperty,
} from '#/shared/testing/server-function-harness'
import type { Property } from '../domain/types'
import { seedTestProperty } from '../profile/property.test-fixtures'

export const ACCOUNT_SUFFIX = 'account-suffix-4410'
export const LOCATION_SUFFIX = 'location-suffix-7731'
export const REVIEW_URI = 'https://search.google.com/local/writereview?placeid=held-9902'
export const RETRIEVED_AT = new Date('2026-09-01T09:00:00.000Z')

export type GoogleBoundProperty = TestProperty & Readonly<{ connectionId: string }>

/**
 * A Property linked to a Google location through a real connection row, with a
 * stored review destination. Overrides replace any column of the Property.
 */
export async function seedGoogleBoundProperty(
  harness: ServerFunctionHarness,
  organization: TestOrganization,
  overrides: Partial<Omit<Property, 'id'>> = {},
): Promise<GoogleBoundProperty> {
  const id = crypto.randomUUID()
  const { connectionId } = await seedGoogleConnection(harness.pool(), {
    organizationId: organization.id,
  })
  await seedTestProperty(
    getDb(),
    buildTestProperty({
      id,
      slug: `bound-${id}`,
      name: 'Harbour Hotel',
      organizationId: organizationId(organization.id),
      gbpAccountId: ACCOUNT_SUFFIX,
      gbpLocationId: LOCATION_SUFFIX,
      googleConnectionId: googleConnectionId(connectionId),
      googleBindingState: 'active',
      googleReviewDestination: {
        state: 'awaiting_refresh',
        uri: REVIEW_URI,
        retrievedAt: RETRIEVED_AT,
        sourceEpoch: 0,
        profileVersion: 1,
      },
      ...overrides,
    }),
  )
  return { id, organizationId: organization.id, connectionId }
}

/**
 * What the manager app reads is still in a Property answer, and no Google
 * identity is, under any key or anywhere in its JSON.
 */
export function expectBrowserProperty(
  property: unknown,
  bound: GoogleBoundProperty,
  expected: Readonly<{ lifecycleState: string }>,
): void {
  expect(property).toMatchObject({
    id: bound.id,
    name: 'Harbour Hotel',
    lifecycleState: expected.lifecycleState,
    googleBindingState: 'active',
    profileVersion: expect.any(Number),
    googleReviewDestination: { state: expect.any(String) },
  })
  const wire = JSON.stringify(property)
  for (const withheld of [
    ACCOUNT_SUFFIX,
    LOCATION_SUFFIX,
    bound.connectionId,
    REVIEW_URI,
  ]) {
    expect(wire).not.toContain(withheld)
  }
  const keys = Object.keys(property as object)
  for (const withheld of ['gbpAccountId', 'gbpLocationId', 'googleConnectionId']) {
    expect(keys).not.toContain(withheld)
  }
  const destination = (property as { googleReviewDestination: object })
    .googleReviewDestination
  expect(destination).not.toHaveProperty('uri')
}
