import { z } from 'zod/v4'

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Database — Neon PostgreSQL
  DATABASE_URL: z.url(),
  DATABASE_URL_POOLER: z.url().optional(),

  // Auth — Better Auth
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),

  // Email — Resend
  RESEND_API_KEY: z.string().min(1),

  // Redis — Upstash / Railway Redis
  REDIS_URL: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
})

export type Env = z.infer<typeof envSchema>

let _env: Env | undefined

export function getEnv(): Env {
  if (!_env) {
    const parsed = envSchema.safeParse(process.env)
    if (!parsed.success) {
      const errors = parsed.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')
      throw new Error(`❌ Invalid environment variables:\n${errors}`)
    }
    _env = parsed.data
  }
  return _env
}

/** Reset cached env — useful for tests */
export function resetEnv(): void {
  _env = undefined
}
