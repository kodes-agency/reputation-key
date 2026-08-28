import { describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import type { GoogleImportV2ItemJobData } from '../../application/ports/gbp-queue.port'
import { createGoogleImportV2ItemJobHandler } from './import-gbp-property-item-v2.job'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '#/shared/domain/data-cell-catalogue'

const DATA: GoogleImportV2ItemJobData = {
  jobId: 'import-item-10000000-0000-4000-8000-000000000001-l2-enew-r0',
  organizationId: 'org-1',
  importJobId: '20000000-0000-4000-8000-000000000002',
  itemId: '10000000-0000-4000-8000-000000000001',
  retryRevision: 0,
  routing: {
    subject: {
      kind: 'import_item',
      organizationId: 'org-1',
      itemId: '10000000-0000-4000-8000-000000000001',
    },
    cell: 'us',
    region: 'us',
    workloadClass: 'property.import',
    routingPolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
  },
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
      attemptOrdinal: 1,
    })
  })

  it('normalizes Bull attemptsMade to a one-based durable ordinal', async () => {
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
