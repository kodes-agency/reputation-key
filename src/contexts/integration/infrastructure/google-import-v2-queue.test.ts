// Google import item queue unit tests.
//
// The item family is organization-scoped: the delayed-execution gate decides
// each job from the Organization in its payload, so every item is enqueued
// inside the execution envelope that carries it.

import { describe, expect, it, vi } from 'vitest'
import { EXECUTION_POLICY_VERSION } from '#/shared/auth/execution-policy'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import { GOOGLE_PROPERTY_IMPORT_ITEM_JOB } from '../application/google-import-v2-contract'
import { createGoogleImportV2Queue } from './google-import-v2-queue'

const item = (suffix: number) => ({
  jobId: `google-import-item-${suffix}`,
  organizationId: 'google-import-queue-test',
  importJobId: '72000000-0000-4000-8000-000000000001',
  itemId: `72000000-0000-4000-8000-00000000010${suffix}`,
  retryRevision: 0,
})

function createQueue() {
  const addBulk = vi.fn(async (_jobs: ReadonlyArray<unknown>) => [])
  return { addBulk }
}

describe('Google import item queue', () => {
  it('queues a batch in one call, each item under its Organization and job id', async () => {
    const queue = createQueue()

    await createGoogleImportV2Queue(queue).addImportItemJobs([item(1), item(2)])

    expect(queue.addBulk).toHaveBeenCalledExactlyOnceWith(
      [item(1), item(2)].map((data) => ({
        name: GOOGLE_PROPERTY_IMPORT_ITEM_JOB,
        data: {
          ...data,
          capability: 'property.import_gbp_v2',
          initiator: { kind: 'system', id: 'outbox:google-property-import-dispatch' },
          policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
        },
        opts: {
          jobId: data.jobId,
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
          ...jobEnqueueOptions(GOOGLE_PROPERTY_IMPORT_ITEM_JOB),
        },
      })),
    )
  })

  it('queues nothing for an empty batch', async () => {
    const queue = createQueue()

    await createGoogleImportV2Queue(queue).addImportItemJobs([])

    expect(queue.addBulk).not.toHaveBeenCalled()
  })

  it('refuses an item without an Organization rather than queueing a job the gate must deny', async () => {
    const queue = createQueue()

    await expect(
      createGoogleImportV2Queue(queue).addImportItemJobs([
        { ...item(1), organizationId: '' },
      ]),
    ).rejects.toThrow('job execution envelope requires organizationId')
    expect(queue.addBulk).not.toHaveBeenCalled()
  })
})
