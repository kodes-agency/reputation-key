// BETA-3 B3.5: Privacy-safe telemetry initialization.
//
// Provides Sentry initialization with a PII-scrubbing beforeSend hook.
// Telemetry export failure never blocks business work.
//
// Usage:
//   import { initObservability } from '#/shared/observability/telemetry'
//   initObservability()  // call once at startup

import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'

// ── PII scrubbing ──────────────────────────────────────────────────

const PII_FIELD_NAMES = new Set([
  'email',
  'reviewerName',
  'reviewer_name',
  'text',
  'reviewText',
  'review_text',
  'snippet',
  'comment',
  'noteText',
  'note_text',
  'rejectionReason',
  'rejection_reason',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'idToken',
  'id_token',
  'token',
  'password',
  'cookie',
  'authorization',
  'apiKey',
  'api_key',
  'googleEmail',
  'google_email',
  'ipAddress',
  'ip_address',
  'userAgent',
  'user_agent',
  'phoneNumber',
  'phone_number',
])

const PII_URL_PATTERNS = [
  /\/reviews\/[a-f0-9-]+/gi,
  /\/properties\/[a-f0-9-]+/gi,
  /token=[^&]+/gi,
  /key=[^&]+/gi,
]

/** Minimal Sentry interface — avoids importing @sentry/node types. */
interface SentryLike {
  init(opts: {
    dsn: string
    environment: string
    tracesSampleRate: number
    sendDefaultPii: boolean
    beforeSend: (event: unknown) => unknown
    beforeBreadcrumb: (crumb: { data?: Record<string, unknown> }) => unknown
  }): void
}

/**
 * Scrub PII from a Sentry event before transmission.
 */
export function scrubSentryEvent(event: unknown): unknown {
  if (!event || typeof event !== 'object') return event
  return deeplyScrub(event, new WeakSet<object>())
}

function deeplyScrub(obj: unknown, seen: WeakSet<object>): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj
  if (seen.has(obj as object)) return obj
  seen.add(obj as object)

  if (Array.isArray(obj)) {
    return obj.map((item) => deeplyScrub(item, seen))
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (PII_FIELD_NAMES.has(key)) {
      result[key] = '[REDACTED]'
    } else if (typeof value === 'string') {
      result[key] = scrubUrlPII(value)
    } else if (typeof value === 'object') {
      result[key] = deeplyScrub(value, seen)
    } else {
      result[key] = value
    }
  }
  return result
}

function scrubUrlPII(value: string): string {
  let result = value
  for (const pattern of PII_URL_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]')
  }
  return result
}

// ── Initialization ─────────────────────────────────────────────────

let initialized = false

export async function initObservability(): Promise<void> {
  if (initialized) return
  initialized = true

  const env = getEnv()
  const logger = getLogger()

  if (env.SENTRY_DSN) {
    logger.info('Initializing Sentry error monitoring')
    try {
      const sentryModule = '@sentry/node'
      const mod = (await import(sentryModule)) as unknown as SentryLike
      mod.init({
        dsn: env.SENTRY_DSN,
        environment: env.NODE_ENV,
        tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
        sendDefaultPii: false,
        beforeSend: (event) => scrubSentryEvent(event),
        beforeBreadcrumb: (crumb) => {
          if (crumb.data) {
            crumb.data = deeplyScrub(crumb.data, new WeakSet<object>()) as Record<
              string,
              unknown
            >
          }
          return crumb
        },
      })
      logger.info({ sampleRate: env.SENTRY_TRACES_SAMPLE_RATE }, 'Sentry initialized')
    } catch (err) {
      logger.warn(
        { err },
        'Sentry initialization failed — continuing without error monitoring',
      )
    }
  } else {
    logger.info('SENTRY_DSN not set — error monitoring disabled')
  }
}
