// Reviews that carry a v3 analysis, for the specs that follow Guest voice 2.0 and the
// Inbox's reading of a review.
//
// The rows are written by the seed the integration suites use, through the product's own
// output and aggregate stores (`ai-v3-seed.ts`), into a Property this fixture makes in the
// e2e Organization the way every other spec makes one. The stack's web and worker then
// serve and notify as they would for a Property whose reviews were analysed. No provider is
// called and no guest's words exist: only ids, stars, topics and sentence numbers.
//
// The fixture also makes the people the journeys need: a PropertyManager with a grant on
// the Property (no Staff rows, as in the real product) who is also its responsible manager,
// which is who an Urgent alert is for.
//
// The seed's graph is loaded with tsx rather than by Playwright's loader (see
// `ai-v3-seed-factory.ts` for why).
//
// The seed moves the shared AI execution controls to "enabled" and puts them back as it
// found them, so one spec file holds the fixture for all of its tests (serial, one worker)
// and two files that use it must not run at the same moment.
import { randomUUID } from 'node:crypto'
import { tsImport } from 'tsx/esm/api'
import type { SeededIds } from '../../src/contexts/ai/infrastructure/testing/ai-v3-seed'
import { testEnvironment } from '../../src/shared/testing/test-environment'
import type * as SeedFactory from './ai-v3-seed-factory'
import {
  cleanupE2eData,
  dbQuery,
  e2eRunId,
  seedMemberUserWithGrant,
  seedProperty,
  seedReviewInboxItemWithCycle,
} from './fixtures'

const TEST_ENV = testEnvironment()
const DAY_MS = 24 * 60 * 60 * 1000
const REVIEW_HOUR_UTC = 16

let factory: Promise<typeof SeedFactory> | undefined

function seedFactory(): Promise<typeof SeedFactory> {
  factory ??= tsImport('./ai-v3-seed-factory.ts', import.meta.url) as Promise<
    typeof SeedFactory
  >
  return factory
}

/** Midday UTC, this many days ago: the same calendar day in the Property's New York time. */
export function daysAgo(days: number): Date {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), REVIEW_HOUR_UTC) -
      days * DAY_MS,
  )
}

export type V3Fixture = Readonly<{
  organizationId: string
  propertyId: string
  manager: Readonly<{ userId: string; email: string; password: string }>
  seed: SeedFactory.OpenV3Seed['seed']
  /** The id of the review the seed made at this index. */
  reviewIdOf: (index: number) => string
  /** An Inbox item for a seeded review, reachable from the product; returns its id. */
  openInboxItem: (index: number) => Promise<string>
  /** Removes the AI rows, the Inbox items, the people and the Property this fixture made. */
  tearDown: () => Promise<void>
}>

export async function setUpV3Fixture(input: {
  organizationId: string
  /** A spec's cleanup prefix: every row the fixture names starts with it. */
  prefix: string
  label: string
}): Promise<V3Fixture> {
  const { organizationId, prefix, label } = input
  const slug = `${prefix}${label}-${e2eRunId}`
  const { propertyId } = await seedProperty({
    organizationId,
    name: `E2E ${label} Property`,
    slug,
  })
  const manager = await seedMemberUserWithGrant({
    organizationId,
    propertyId,
    email: `${slug}-manager@example.com`,
    name: 'E2E v3 Manager',
    role: 'admin',
  })
  // The Property's responsible manager is who its review notices are for; without one
  // they go to the Organization's AccountAdmins instead.
  await dbQuery(
    `INSERT INTO property_responsible_managers
       (organization_id, property_id, user_id, effective_from, created_by)
     VALUES ($1, $2::uuid, $3, now() - interval '1 hour', 'e2e-fixture')`,
    [organizationId, propertyId, manager.userId],
  )

  // Eight hex characters: ids made for reviews and operations start with them.
  const ids: SeededIds = {
    organizationId,
    propertyId,
    idPrefix: randomUUID().slice(0, 8),
  }
  const { openV3Seed, seededReviewId } = await seedFactory()
  const { seed, close } = openV3Seed(TEST_ENV.DATABASE_URL, ids)
  await seed.setUp()

  return {
    organizationId,
    propertyId,
    manager,
    seed,
    reviewIdOf: (index) => seededReviewId(ids, index),
    openInboxItem: async (index) =>
      (
        await seedReviewInboxItemWithCycle({
          organizationId,
          propertyId,
          reviewId: seededReviewId(ids, index),
        })
      ).inboxItemId,
    tearDown: async () => {
      // The Inbox first: its rows hold the reviews up, and the reviews hold up the AI rows.
      await dbQuery(
        'DELETE FROM inbox_items WHERE organization_id = $1 AND property_id = $2',
        [organizationId, propertyId],
      )
      try {
        await seed.tearDown()
      } finally {
        await close()
      }
      await cleanupE2eData({ organizationId, prefix })
    },
  }
}

/** Six dated comments, including a concern below the pattern eligibility threshold. */
export async function seedSmallCheckIn(fixture: V3Fixture): Promise<void> {
  for (let index = 101; index <= 106; index += 1) {
    await fixture.seed.addReview({
      index,
      rating: index === 101 ? 1 : 4,
      reviewedAt: daysAgo(index - 100),
      sentiment: index === 101 ? 'negative' : 'positive',
      attention: index === 101 ? 'urgent' : 'low',
      urgentReason: index === 101 ? 'health' : undefined,
      mentions:
        index === 101
          ? [
              {
                topic: 'cleanliness',
                polarity: 'negative',
                strength: 'strong',
                thing: 'room',
                issue: 'reported mould',
                sentences: [1],
                namesPerson: null,
              },
            ]
          : [],
    })
  }
  await fixture.seed.seal()
}
