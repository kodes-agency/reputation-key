import { vi } from 'vitest'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import {
  setupDiscoveryDb,
  type DiscoveryPropertyFixture,
} from '#/shared/testing/review-discovery-fixtures'
import type { ReviewSyncActivityRecorder } from './review-sync-activity-repository.port.server'
import type { ReviewDiscoveryRepository } from './review-discovery-repository.port.server'
import { createReviewDiscoveryRepository } from './review-discovery-repository.server'

/**
 * The in-memory-free discovery repository over the test database. Call once per
 * test file: it registers the database lifecycle hooks.
 */
export function useDiscoveryDb() {
  const discoveryDb = setupDiscoveryDb(createReviewDiscoveryRepository)

  /** The repository over a database seeded with the fixtures. */
  async function seedRepo(rows: DiscoveryPropertyFixture[]) {
    await discoveryDb.seed(rows)
    return discoveryDb.repo()
  }

  /** What the repository stored for the fixture's Property. */
  const stored = (row: DiscoveryPropertyFixture) => discoveryDb.read(row.propertyId)

  return { discoveryDb, seedRepo, stored }
}

export const NOW = new Date('2026-08-21T12:00:00.000Z')
export const HOT_INTERVAL_MS = 15 * 60 * 1000

export const JOB_DATA = {
  propertyId: '11111111-1111-4111-8111-111111111111',
  organizationId: '33333333-3333-4333-8333-333333333333',
  connectionId: '22222222-2222-4222-8222-222222222222',
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
}

export const propertySourceEpoch = {
  getSourceEpoch: vi.fn(async () => ({ sourceEpoch: 7 })),
}

export const makeSyncActivity = (): ReviewSyncActivityRecorder => ({
  recordNewReviewObserved: vi.fn(async () => undefined),
  recordPushObserved: vi.fn(async () => undefined),
})

export const makeDiscoveryState = (): Pick<
  ReviewDiscoveryRepository,
  'markDiscoveryDeferred' | 'findFailureState' | 'markSyncSucceeded'
> => ({
  markDiscoveryDeferred: vi.fn(async () => undefined),
  findFailureState: vi.fn(async () => null),
  markSyncSucceeded: vi.fn(async () => undefined),
})

export const ladderDeps = (
  syncActivity: ReviewSyncActivityRecorder,
  discoveryRepo = makeDiscoveryState(),
) => ({
  syncActivity,
  discoveryRepo,
  clock: () => NOW,
  hotIntervalMs: HOT_INTERVAL_MS,
})

/**
 * The function that built an error: the first frame of its stack that is not the
 * error class's own constructor.
 */
export function throwSite(error: Error): string | undefined {
  const names = (error.stack ?? '')
    .split('\n')
    .map((line) => /^\s*at (?:async )?(?:new )?([^\s(]+)/u.exec(line)?.[1])
  return names.find(
    (name) => name !== undefined && name !== 'ReviewProviderSnapshotFailure',
  )
}
