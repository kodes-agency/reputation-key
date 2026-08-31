import type { Redis } from 'ioredis'
import type { OAuthCallbackQuotaCounter } from '../application/oauth-callback-abuse-gate'

const CONSUME_SCRIPT = `
local projectCount = redis.call('INCR', KEYS[1])
if projectCount == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
local subjectCount = redis.call('INCR', KEYS[2])
if subjectCount == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[2]) end
if projectCount > tonumber(ARGV[1]) or subjectCount > tonumber(ARGV[1]) then
  return 0
end
return 1
`

const SAFE_KEY = /^[A-Za-z0-9_-]{32,128}$/

export const createRedisOAuthCallbackQuotaCounter = (
  redis: Redis,
): OAuthCallbackQuotaCounter => {
  return Object.freeze({
    consume: async (input) => {
      if (
        !SAFE_KEY.test(input.projectKey) ||
        !SAFE_KEY.test(input.subjectKey) ||
        !Number.isSafeInteger(input.nowMs) ||
        !Number.isSafeInteger(input.limit) ||
        !Number.isSafeInteger(input.windowMs) ||
        input.limit < 1 ||
        input.windowMs < 1
      ) {
        return false
      }
      const window = Math.floor(input.nowMs / input.windowMs)
      const prefix = `oauth-callback:{abuse-v1}:${input.audience}`
      const result = await redis.eval(
        CONSUME_SCRIPT,
        2,
        `${prefix}:project:${input.projectKey}:${window}`,
        `${prefix}:subject:${input.subjectKey}:${window}`,
        input.limit,
        input.windowMs * 2,
      )
      return Number(result) === 1
    },
  })
}
