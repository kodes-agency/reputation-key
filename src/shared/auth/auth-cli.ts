/**
 * Better Auth CLI configuration.
 *
 * This file is used exclusively by the `@better-auth/cli` tool
 * (generate, migrate, etc.). It reuses the same options as auth.ts
 * but avoids Vite path aliases (`#/...`) that the CLI can't resolve.
 *
 * Usage:
 *   pnpm auth:generate   → generate SQL migration
 *   pnpm auth:migrate    → apply pending migrations
 */
import { betterAuth } from 'better-auth'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER ?? process.env.DATABASE_URL,
})

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours (rolling)
  },
})

export default auth
