import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import {
  DISCOVERY_SWEEP_SYNC_INITIATOR_ID,
  GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID,
} from '../ports/review-queue.port'
import { admitReviewSync } from './admit-review-sync'

const ORG = 'org-review-sync-admission'
const PROPERTY = '75000000-0000-4000-8000-000000000001'
const IMPORT_SYNC = {
  organizationId: ORG,
  propertyId: PROPERTY,
  connectionId: '75000000-0000-4000-8000-000000000002',
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  initiator: { kind: 'system' as const, id: GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID },
  correlationId: 'google-import:item-1',
}
const IMPORT_JOB = { jobId: `review-sync-${PROPERTY}-source-epoch-2` }

function setup(
  options: Readonly<{ sourceEpoch?: number | null; cutoffFailure?: Error }> = {},
) {
  const effects: string[] = []
  const sourceEpoch = options.sourceEpoch === undefined ? 2 : options.sourceEpoch
  const deps = {
    queue: {
      addSyncJob: vi.fn(async () => {
        effects.push('sync queued')
      }),
    },
    propertySourceEpoch: {
      getSourceEpoch: vi.fn(async () => (sourceEpoch === null ? null : { sourceEpoch })),
    },
    historyCutoffs: {
      fixImportHistoryCutoff: vi.fn(async () => {
        if (options.cutoffFailure) throw options.cutoffFailure
        effects.push('cutoff fixed')
      }),
    },
  }
  return { deps, effects, admit: admitReviewSync(deps) }
}

describe('admitReviewSync', () => {
  it("fixes the import's history cutoff in the Property's current epoch before its sync is queued", async () => {
    const { deps, effects, admit } = setup({ sourceEpoch: 2 })

    await admit(IMPORT_SYNC, IMPORT_JOB)

    expect(deps.historyCutoffs.fixImportHistoryCutoff).toHaveBeenCalledWith({
      organizationId: organizationId(ORG),
      propertyId: propertyId(PROPERTY),
      sourceEpoch: 2,
    })
    // Discovery may poll the Property as soon as the import settles, which the
    // import does right after this admission returns.
    expect(effects).toEqual(['cutoff fixed', 'sync queued'])
    expect(deps.queue.addSyncJob).toHaveBeenCalledWith(IMPORT_SYNC, IMPORT_JOB)
  })

  it('queues every other sync without fixing a cutoff', async () => {
    const { deps, admit } = setup()
    const sweep = {
      ...IMPORT_SYNC,
      initiator: { kind: 'system' as const, id: DISCOVERY_SWEEP_SYNC_INITIATOR_ID },
    }

    await admit(sweep)

    expect(deps.historyCutoffs.fixImportHistoryCutoff).not.toHaveBeenCalled()
    expect(deps.propertySourceEpoch.getSourceEpoch).not.toHaveBeenCalled()
    expect(deps.queue.addSyncJob).toHaveBeenCalledWith(sweep, undefined)
  })

  it('still queues an import whose Property has no Google source left, which its sync then refuses', async () => {
    const { deps, admit } = setup({ sourceEpoch: null })

    await admit(IMPORT_SYNC, IMPORT_JOB)

    expect(deps.historyCutoffs.fixImportHistoryCutoff).not.toHaveBeenCalled()
    expect(deps.queue.addSyncJob).toHaveBeenCalledWith(IMPORT_SYNC, IMPORT_JOB)
  })

  it('queues nothing when the cutoff cannot be fixed, so the import retries its admission', async () => {
    const failure = new Error('canceling statement due to lock timeout')
    const { deps, admit } = setup({ cutoffFailure: failure })

    await expect(admit(IMPORT_SYNC, IMPORT_JOB)).rejects.toBe(failure)

    expect(deps.queue.addSyncJob).not.toHaveBeenCalled()
  })
})
