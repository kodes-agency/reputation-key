import { isRedisHealthy } from '#/shared/cache/redis'
import { isJobRedisHealthy } from '#/shared/jobs/redis-runtime'

/** Both independent Redis resources are serving their assigned workload. */
export async function areRedisDependenciesHealthy(): Promise<boolean> {
  const [cache, queue] = await Promise.all([isRedisHealthy(), isJobRedisHealthy()])
  return cache && queue
}
