import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireTestLease } from '../../src/shared/testing/test-environment-lease'
import { restorePopulatedUpgradeFixture } from './populated-upgrade-fixture'
import { bootUpgradeImage, migrateUpgradeImage } from './populated-upgrade-images'
import { checkPopulatedUpgradeImages } from './populated-upgrade-image-check'

vi.mock('../../src/shared/testing/test-environment-lease', () => ({
  acquireTestLease: vi.fn(),
}))
vi.mock('./populated-upgrade-fixture', async (original) => ({
  ...(await original<typeof import('./populated-upgrade-fixture')>()),
  restorePopulatedUpgradeFixture: vi.fn(),
}))
vi.mock('./populated-upgrade-images', () => ({
  bootUpgradeImage: vi.fn(),
  migrateUpgradeImage: vi.fn(),
  upgradeImageJournal: () => ({ entries: [{ when: 1 }] }),
}))

const release = vi.fn()
const maintenanceQuery = vi.fn()
let customerText: string

beforeEach(() => {
  vi.stubEnv('POPULATED_UPGRADE_PREVIOUS_IMAGE', 'released')
  vi.stubEnv('POPULATED_UPGRADE_NEW_IMAGE', 'candidate')
  customerText = 'preserved customer work'
  vi.mocked(acquireTestLease)
    .mockResolvedValueOnce({ pool: { query: maintenanceQuery }, release } as never)
    .mockResolvedValueOnce({
      pool: {
        query: async (query: string) => {
          if (query.includes('max(created_at)')) return { rows: [{ value: 0 }] }
          if (query.includes('__drizzle_migrations'))
            return { rows: [{ hash: 'unchanged', created_at: 1 }] }
          // Two tenants have independent customer work. Transport fakes return
          // new row objects, as PostgreSQL does, on every snapshot read.
          return {
            rows: [
              { id: 'first', organization_id: 'tenant-a', text: customerText },
              { id: 'second', organization_id: 'tenant-b', text: 'untouched' },
            ],
          }
        },
      },
      release,
    } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})

describe('populated image data preservation gate', () => {
  it.each([
    'released migration',
    'released boot',
    'candidate migration',
    'candidate reapplication',
    'candidate boot',
    'released boot after upgrade',
  ])(
    'fails when %s silently rewrites populated rows despite an unchanged journal',
    async (fault) => {
      let candidateApplications = 0
      let releasedBoots = 0
      vi.mocked(migrateUpgradeImage).mockImplementation((image) => {
        if (image === 'candidate') candidateApplications++
        if (
          (fault === 'released migration' && image === 'released') ||
          (fault === 'candidate migration' && candidateApplications === 1) ||
          (fault === 'candidate reapplication' && candidateApplications === 2)
        )
          customerText = 'silently rewritten'
      })
      vi.mocked(bootUpgradeImage).mockImplementation(async (image) => {
        if (image === 'released') releasedBoots++
        // A later migration can conceal damage to the released schema.
        if (fault === 'released migration' && image === 'released')
          customerText = 'preserved customer work'
        if (fault === 'candidate boot' && image === 'candidate')
          customerText = 'silently rewritten'
        if (
          (fault === 'released boot' && releasedBoots === 1) ||
          (fault === 'released boot after upgrade' && releasedBoots === 2)
        )
          customerText = 'silently rewritten'
      })
      await expect(checkPopulatedUpgradeImages()).rejects.toMatchObject({
        code: 'ERR_ASSERTION',
      })
      expect(release).toHaveBeenCalledTimes(2)
      expect(maintenanceQuery.mock.calls.at(-1)?.[0]).toMatch(/^DROP DATABASE /)
    },
  )

  it('uses one pinned restore and preserves data across both image boots and reapplication', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(checkPopulatedUpgradeImages()).resolves.toBeUndefined()
    expect(restorePopulatedUpgradeFixture).toHaveBeenCalledTimes(1)
    expect(vi.mocked(migrateUpgradeImage).mock.calls.map(([image]) => image)).toEqual([
      'released',
      'candidate',
      'candidate',
    ])
    expect(vi.mocked(bootUpgradeImage).mock.calls.map(([image]) => image)).toEqual([
      'released',
      'candidate',
      'released',
    ])
  })
})
