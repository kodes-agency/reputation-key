import type { Database } from '#/shared/db'
import type { Redis } from 'ioredis'
import { createAiDataLifecycle } from './infrastructure/ai-data-lifecycle'

export type AiContextBuildInput = Readonly<{
  db: Database
  redis: Redis | undefined
}>

export function buildAiContext(input: AiContextBuildInput) {
  const dataLifecycle = input.redis
    ? createAiDataLifecycle(input.db, input.redis)
    : undefined

  return Object.freeze({
    publicApi: Object.freeze({}),
    internal: Object.freeze({ dataLifecycle }),
  })
}
