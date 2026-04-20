// Better Auth server configuration
import { betterAuth } from 'better-auth'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'

export function createAuth() {
  const env = getEnv()
  const pool = new Pool({
    connectionString: env.DATABASE_URL_POOLER ?? env.DATABASE_URL,
  })

  return betterAuth({
    database: pool,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
    },
    plugins: [tanstackStartCookies()],
  })
}

// Lazy singleton — created once, reused across requests
let _auth: ReturnType<typeof createAuth> | undefined

export function getAuth() {
  if (!_auth) {
    _auth = createAuth()
  }
  return _auth
}
