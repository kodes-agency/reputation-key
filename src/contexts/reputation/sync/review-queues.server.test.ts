// Review job producers: what each enqueue hands BullMQ.

import { describe, expect, it, vi } from 'vitest'
import { createReviewQueues } from './review-queues.server'
import { EXECUTION_POLICY_VERSION } from '#/shared/auth/execution-policy'

function setup() {
  const jobQueue = {
    add: vi.fn(async (_name: string, _data: unknown, _options: unknown) => ({})),
  }
  return { jobQueue, queues: createReviewQueues(jobQueue as never) }
}

const SYNC_DATA = {
  propertyId: 'prop-1',
  organizationId: 'org-1',
  connectionId: 'conn-1',
  locationName: 'locations/1',
}

const SYNC_EXECUTION = {
  capability: 'property.connect_gbp',
  initiator: { kind: 'system', id: 'queue:review-sync' },
  policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
} as const

describe('Review queues', () => {
  it('enqueues a head check as a governed sync-property-reviews job with its own job id and delay', async () => {
    const { queues, jobQueue } = setup()
    const data = {
      mode: 'head' as const,
      propertyId: 'prop-1',
      organizationId: 'org-1',
      connectionId: 'conn-1',
      locationName: 'locations/1',
      initiator: { kind: 'system' as const, id: 'sweep:review-discovery' },
      correlationId: 'review-head:prop-1',
    }

    await queues.headCheckQueue.addHeadCheckJob(data, {
      jobId: 'review-head-prop-1-7',
      delayMs: 90_000,
    })

    const [name, payload, options] = jobQueue.add.mock.calls[0]!
    expect(name).toBe('sync-property-reviews')
    expect(payload).toEqual({
      ...data,
      capability: 'property.connect_gbp',
      policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
    })
    expect(options).toMatchObject({
      jobId: 'review-head-prop-1-7',
      delay: 90_000,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    })
  })

  it('enqueues a head check with no delay option when none is asked for', async () => {
    const { queues, jobQueue } = setup()

    await queues.headCheckQueue.addHeadCheckJob(
      {
        mode: 'head',
        propertyId: 'prop-1',
        organizationId: 'org-1',
        connectionId: 'conn-1',
        locationName: 'locations/1',
      },
      { jobId: 'review-head-prop-1-8' },
    )

    expect(jobQueue.add.mock.calls[0]![2]).not.toHaveProperty('delay')
  })

  // The last link of the backoff chain: a rate-limited continuation asks for a
  // delay, and BullMQ only honours it as the `delay` option.
  it('passes a continuation delay to BullMQ as the delay option, not as job data', async () => {
    const { queues, jobQueue } = setup()

    await queues.queue.addSyncJob(SYNC_DATA, { delayMs: 5_000 })

    const [, data, options] = jobQueue.add.mock.calls[0]!
    expect(options).toMatchObject({ delay: 5_000 })
    expect(data).toEqual({ ...SYNC_DATA, ...SYNC_EXECUTION })
  })

  it('omits delay entirely for an ordinary enqueue', async () => {
    const { queues, jobQueue } = setup()

    await queues.queue.addSyncJob(SYNC_DATA)

    const [, , options] = jobQueue.add.mock.calls[0]!
    expect(options).not.toHaveProperty('delay')
  })

  it('enqueues reply publication with the supplied Property scope', async () => {
    const { queues, jobQueue } = setup()
    const data = {
      replyId: 'reply-1',
      organizationId: 'org-1',
      propertyId: 'prop-9',
    }

    await queues.replyQueue.addPublishJob(data)

    expect(jobQueue.add).toHaveBeenCalledWith(
      'publish-reply',
      {
        ...data,
        capability: 'property.publish_reply',
        initiator: { kind: 'system', id: 'queue:reply-publish' },
        policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
      },
      expect.objectContaining({ removeOnComplete: { count: 100 } }),
    )
  })
})
