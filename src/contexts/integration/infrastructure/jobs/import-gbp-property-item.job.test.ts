import { describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import type { GoogleImportV2ItemJobData } from '../../application/ports/gbp-queue.port'
import { createGoogleImportV2ItemJobHandler } from './import-gbp-property-item.job'

const DATA: GoogleImportV2ItemJobData = {
  jobId:
    'import-item-10000000-0000-4000-8000-000000000001-l2-enew-r0-d0-q20000000-0000-4000-8000-000000000001',
  organizationId: 'org-1',
  importJobId: '20000000-0000-4000-8000-000000000002',
  itemId: '10000000-0000-4000-8000-000000000001',
  retryRevision: 0,
  dispatchEpoch: 0,
}

function job(
  data = DATA,
  id: string | undefined = data.jobId,
  attemptsMade = 0,
): Job<GoogleImportV2ItemJobData> {
  return { id, data, attemptsMade } as Job<GoogleImportV2ItemJobData>
}

describe('Google import v2 item job boundary', () => {
  it('passes a matching deterministic identity to the fenced processor', async () => {
    const processItem = vi.fn(async () => {})

    await createGoogleImportV2ItemJobHandler(processItem)(job())

    expect(processItem).toHaveBeenCalledWith({
      organizationId: DATA.organizationId,
      itemId: DATA.itemId,
      retryRevision: DATA.retryRevision,
      dispatchEpoch: DATA.dispatchEpoch,
      attemptOrdinal: 1,
    })
  })

  it('keeps an already queued delivery without an epoch compatible with generation zero', async () => {
    const processItem = vi.fn(async () => {})
    const { dispatchEpoch: _epoch, ...legacy } = DATA
    const oldId = 'import-item-10000000-0000-4000-8000-000000000001-l2-enew-r0'
    const delivery = {
      id: oldId,
      data: { ...legacy, jobId: oldId },
      attemptsMade: 0,
    } as Job<typeof legacy>
    await createGoogleImportV2ItemJobHandler(processItem)(delivery)
    expect(processItem).toHaveBeenCalledExactlyOnceWith({
      organizationId: DATA.organizationId,
      itemId: DATA.itemId,
      retryRevision: 0,
      dispatchEpoch: 0,
      attemptOrdinal: 1,
    })
  })

  it('passes the one-based queue delivery ordinal as a non-authoritative hint', async () => {
    const processItem = vi.fn(async () => {})

    await createGoogleImportV2ItemJobHandler(processItem)(job(DATA, DATA.jobId, 3))

    expect(processItem).toHaveBeenCalledWith(
      expect.objectContaining({ attemptOrdinal: 4 }),
    )
  })

  it('rejects a mismatched BullMQ identity before processing', async () => {
    const processItem = vi.fn(async () => {})

    await expect(
      createGoogleImportV2ItemJobHandler(processItem)(job(DATA, 'tampered')),
    ).rejects.toThrow('job identity mismatch')
    expect(processItem).not.toHaveBeenCalled()
  })
})
