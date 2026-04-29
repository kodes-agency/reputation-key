// BullMQ queue factory — creates named queues backed by shared Redis.
// Per architecture: "shared/jobs/ holds queue/worker factories and job registry."
//
// NOTE: This should only be called in the worker process (via createContainer({ enableJobs: true })).
// The web process does not need a BullMQ queue — it only needs Redis for caching/rate limiting.
// The enableJobs flag in composition.ts controls whether this factory is invoked.

import { Queue } from 'bullmq'
import { getRedis } from '#/shared/cache/redis'

// fallow-ignore-next-line unused-type
export type { Queue }

export function createJobQueue(name: string): Queue | undefined {
  const redis = getRedis()
  if (!redis) return undefined

  return new Queue(name, {
    connection: redis,
    defaultJobOptions: {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
      attempts: 3,
    },
  })
}
