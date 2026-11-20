// Test support for the AI server-function integration tests: a Property the
// harness made, given Review Analysis consent, a processing profile and the
// analyses of the reviews a test adds, through the real stores.

import { randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterEach } from 'vitest'
import { getDb } from '#/shared/db'
import type { TestProperty } from '#/shared/testing/server-function-harness'
import { createV3Seed } from '../analysis/ai-v3-seed.test-fixtures'

export {
  mentionOf,
  seededReviewId,
  type SeededReview,
} from '../analysis/ai-v3-seed.test-fixtures'

export type AiSeed = ReturnType<typeof createV3Seed>

/**
 * A Property the seed is made for gets a country and time zone to match. Call once at the top of a test file, after `setupServerFunctionHarness()`.
 * The seeds a test makes are taken down after it, before the harness deletes
 * the Property they belong to.
 */
export function useAiSeeds(
  externalLocationId: string,
): (property: TestProperty) => Promise<AiSeed> {
  const seeds: AiSeed[] = []
  afterEach(async () => {
    for (const seed of seeds.splice(0)) await seed.tearDown()
  })
  return async (property) => {
    // The processing profile is cut from the Property's country and time zone.
    await getDb().execute(sql`
      UPDATE properties SET country_code = 'US', timezone = 'America/New_York'
      WHERE id = ${property.id}::uuid AND organization_id = ${property.organizationId}
    `)
    const seed = createV3Seed(
      getDb(),
      {
        organizationId: property.organizationId,
        propertyId: property.id,
        idPrefix: randomBytes(4).toString('hex'),
      },
      { adopt: true, externalLocationId },
    )
    seeds.push(seed)
    return seed
  }
}
