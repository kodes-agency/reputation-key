import { z } from 'zod/v4'

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Database — Neon PostgreSQL
  DATABASE_URL: z.url(),
  DATABASE_URL_POOLER: z.url().optional(),

  // Auth — Better Auth
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .regex(/[a-zA-Z0-9]/, 'Must contain alphanumeric characters'),
  BETTER_AUTH_URL: z.url(),

  // Email — Resend
  RESEND_API_KEY: z.string().min(1),

  // Redis — Upstash / Railway Redis
  REDIS_URL: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Storage — AWS S3
  AWS_S3_ACCESS_KEY: z.string().min(1).optional(),
  AWS_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_S3_BUCKET_NAME: z.string().min(1).optional(),
  AWS_S3_REGION: z.string().min(1).optional(),

  // Error tracking — Sentry (optional, Phase 22 for full integration)
  SENTRY_DSN: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // Guest sessions — required in production, dev-only default for convenience
  GUEST_SESSION_SALT:
    process.env.NODE_ENV === 'production'
      ? z.string().min(16)
      : z.string().min(16).default('dev-only-salt-not-for-production'),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  // Token encryption (32-byte hex key for AES-256-GCM)
  ENCRYPTION_KEY: z
    .string()
    .length(64)
    .regex(/^[a-f0-9]{64}$/, 'Must be 64 hex characters (32 bytes)'),

  // OAuth state signing secret — dedicated key, independent of ENCRYPTION_KEY
  OAUTH_STATE_SECRET: z
    .string()
    .min(32)
    .regex(/^[a-f0-9]+$/, 'Must be hex characters'),

  // Google Pub/Sub webhook audience verification (optional — defaults to /webhooks/gbp path)
  GBP_PUBSUB_AUDIENCE: z.string().optional(),
  // GBP Pub/Sub notification lifecycle (ADR-deferred item #2). One shared topic; empty
  // = notifications disabled (manage-notifications no-ops). `business.manage` covers
  // updateNotificationSetting; topic/subscription/grant are GCP infra, not app code.
  GBP_PUBSUB_TOPIC: z.string().optional().default(''),
  // Comma-separated GBP notification types to subscribe to (default: NEW_REVIEW only).
  GBP_PUBSUB_NOTIFICATION_TYPES: z.string().default('NEW_REVIEW'),
  // Dynamic Access Control — Stage 1 safety gate (ADR 0001).
  // 'true' enables the custom-role model (Stage 2 dynamic resolver). Absent or any
  // other value = false. Parsed as string→bool to avoid z.coerce.boolean()'s
  // Boolean("false") === true pitfall.
  ENABLE_CUSTOM_ROLES: z
    .string()
    .optional()
    .transform((v) => v?.toLowerCase() === 'true'),
})

// fallow-ignore-next-line unused-type
export type Env = z.infer<typeof envSchema>

let _env: Env | undefined

export function getEnv(): Env {
  if (!_env) {
    const parsed = envSchema.safeParse(process.env)
    if (!parsed.success) {
      const errors = parsed.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')
      // Startup-time assertion (not domain/application logic).
      // Plain Error is acceptable here — tagged errors are for domain and application layers.
      throw new Error(`[CONFIG] Invalid environment variables:\n${errors}`)
    }
    _env = parsed.data
  }
  return _env
}

/** Reset cached env — useful for tests */
export function resetEnv(): void {
  _env = undefined
}
