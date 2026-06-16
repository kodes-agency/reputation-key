// IP hashing — server-only (uses Node crypto + the guest-session salt).
//
// Named `*.server.ts` so TanStack Start's import protection (enabled by
// default) mocks this module in the client bundle instead of letting
// `node:crypto` execute in the browser and crash hydration.
// hashIp is only ever called inside server-function handler bodies.

import { createHash } from 'crypto'
import { getEnv } from '#/shared/config/env'

export function hashIp(ip: string): string {
  const env = getEnv()
  const today = new Date().toISOString().slice(0, 10)
  const salt = `${env.GUEST_SESSION_SALT}:${today}`
  return createHash('sha256').update(`${ip}:${salt}`).digest('hex')
}
