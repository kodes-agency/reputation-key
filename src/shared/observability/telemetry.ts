// Privacy-safe server error monitoring for the web and BullMQ worker processes.
//
// The production images preload this module before their application entry so
// Sentry can install its supported Node ESM instrumentation before framework,
// database, queue, and HTTP modules are evaluated. Runtime callers bind to the
// already-initialized SDK, capture only errors plus a tiny metadata allowlist,
// and flush through the existing bounded shutdown paths.
//
// Monitoring is an operational control, not optional product analytics. A
// deployed Railway Data Cell therefore refuses a missing or non-Germany DSN.
// SDK/transport failures still fail open: an observability vendor outage must
// never turn into a RepKey application outage.

import * as Sentry from '@sentry/node'
import { z } from 'zod/v4'
import { getLogger } from '#/shared/observability/logger'
import { isSensitiveObservabilityField } from '#/shared/observability/sensitive-field-policy'

const REDACTED = '[REDACTED]'
const ERROR_MONITOR_FLUSH_BUDGET_MS = 1_500

const ALLOWED_EVENT_TAGS = new Set([
  'service',
  'processing_cell',
  'release_sha',
  'runtime_source',
  'termination_trigger',
  'queue',
  'job_name',
])

const ALLOWED_CONTEXT_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  app: new Set(['app_name', 'app_version', 'app_build']),
  device: new Set(['arch', 'brand', 'family', 'model', 'model_id']),
  os: new Set(['name', 'version', 'kernel_version']),
  response: new Set(['status_code']),
  runtime: new Set(['name', 'version']),
  trace: new Set(['trace_id', 'span_id', 'parent_span_id', 'op', 'origin', 'status']),
}

export type ObservabilityService = 'web' | 'worker'
export type ObservabilityInitResult = 'enabled' | 'disabled' | 'failed'

export interface ObservabilityConfig {
  readonly service: ObservabilityService
  readonly dsn?: string
  readonly environment: string
  readonly release: string
  readonly processingCell: string
  readonly tracesSampleRate: number
}

const observabilityEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PROCESSING_CELL: z.string().min(1).default('us'),
  RAILWAY_ENVIRONMENT_NAME: z.string().min(1).optional(),
  RELEASE_SHA: z.string().min(1).optional(),
  RAILWAY_GIT_COMMIT_SHA: z.string().min(1).optional(),
  SENTRY_DSN: z.url().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
})

type ObservabilityEnvironment = z.infer<typeof observabilityEnvironmentSchema>

export interface ErrorMonitoringSdk {
  init(options: {
    readonly dsn: string
    readonly environment: string
    readonly release: string
    readonly tracesSampleRate: number
    readonly sendDefaultPii: false
    readonly includeLocalVariables: false
    readonly serverName: string
    readonly integrations: (
      defaults: ReadonlyArray<{ readonly name?: string }>,
    ) => ReadonlyArray<{ readonly name?: string }>
    readonly beforeSend: (event: unknown) => unknown
    readonly beforeSendTransaction: (event: unknown) => unknown
    readonly beforeBreadcrumb: (breadcrumb: SentryBreadcrumb) => SentryBreadcrumb
  }): unknown
  isInitialized(): boolean
  setTags(tags: Readonly<Record<string, string>>): void
  captureException(
    error: Error,
    context: { readonly tags: Readonly<Record<string, string>> },
  ): unknown
  flush(timeoutMs: number): Promise<boolean>
}

interface ErrorMonitoringLogger {
  info(obj: Record<string, unknown>, message: string): void
  warn(obj: Record<string, unknown>, message: string): void
  error(obj: Record<string, unknown>, message: string): void
}

export interface ErrorCaptureContext {
  readonly source:
    'nitro' | 'worker-process' | 'worker-startup' | 'bullmq-worker' | 'bullmq-job'
  readonly trigger?:
    | 'SIGTERM'
    | 'SIGINT'
    | 'unhandledRejection'
    | 'uncaughtException'
    | 'startup'
    | 'shutdown'
  readonly queue?: string
  readonly jobName?: string
}

export interface ErrorMonitor {
  initialize(config: ObservabilityConfig): ObservabilityInitResult
  captureException(error: unknown, context: ErrorCaptureContext): void
  flush(timeoutMs?: number): Promise<boolean>
}

export interface SentryBreadcrumb {
  readonly type?: string
  readonly category?: string
  readonly level?: string
  readonly timestamp?: number
  readonly message?: string
  readonly data?: Record<string, unknown>
}

// ── PII scrubbing ──────────────────────────────────────────────────

const PII_STRING_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  /\bBearer\s+[^\s]+/giu,
  /\bpostgres(?:ql)?:\/\/[^\s/@:]+:[^\s/@]+@/giu,
  /\bredis(?:s)?:\/\/[^\s/@:]+:[^\s/@]+@/giu,
  /\/[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?=\/|\?|#|$)/giu,
  /([?&](?:token|key|code|secret|password|email)=)[^&#\s]+/giu,
]

function scrubString(value: string): string {
  let result = value
  for (const pattern of PII_STRING_PATTERNS) {
    result = result.replace(pattern, (_match, prefix?: string) =>
      typeof prefix === 'string' ? `${prefix}${REDACTED}` : REDACTED,
    )
  }
  return result
}

/**
 * Scrub protected fields recursively, then apply Sentry-specific structural
 * denials. Generic exception messages and arbitrary request/user/extra data
 * are not reliably classifiable, so they are removed rather than guessed at.
 */
export function scrubSentryEvent(event: unknown): unknown {
  if (!event || typeof event !== 'object') return event
  const scrubbed = deeplyScrub(event, new WeakMap<object, unknown>())
  if (!scrubbed || typeof scrubbed !== 'object' || Array.isArray(scrubbed)) {
    return scrubbed
  }

  const record = scrubbed as Record<string, unknown>
  if ('message' in record) record.message = REDACTED
  if ('transaction' in record) record.transaction = REDACTED
  delete record.user
  delete record.extra
  delete record.attachments
  delete record.fingerprint
  delete record.culprit
  delete record.logentry

  if ('tags' in record) record.tags = scrubEventTags(record.tags)
  if ('contexts' in record) record.contexts = scrubEventContexts(record.contexts)

  const request = asRecord(record.request)
  if (request) {
    if (typeof request.method === 'string') record.request = { method: request.method }
    else delete record.request
  }

  const exception = asRecord(record.exception)
  if (exception && Array.isArray(exception.values)) {
    for (const value of exception.values) {
      const exceptionValue = asRecord(value)
      if (!exceptionValue) continue
      if ('value' in exceptionValue) exceptionValue.value = REDACTED
      scrubExceptionMechanism(exceptionValue.mechanism)
      scrubStacktrace(exceptionValue.stacktrace)
    }
  }

  const threads = asRecord(record.threads)
  if (threads && Array.isArray(threads.values)) {
    for (const thread of threads.values) scrubStacktrace(asRecord(thread)?.stacktrace)
  }

  if (Array.isArray(record.breadcrumbs)) {
    record.breadcrumbs = record.breadcrumbs.map((breadcrumb) =>
      scrubSentryBreadcrumb(asRecord(breadcrumb) ?? {}),
    )
  }

  if (Array.isArray(record.spans)) {
    for (const span of record.spans) {
      const spanRecord = asRecord(span)
      if (!spanRecord) continue
      if ('description' in spanRecord) spanRecord.description = REDACTED
      delete spanRecord.data
    }
  }

  return scrubbed
}

/** Keep only breadcrumb classification/timing; never content or request data. */
export function scrubSentryBreadcrumb(breadcrumb: SentryBreadcrumb): SentryBreadcrumb {
  return {
    ...(typeof breadcrumb.type === 'string' ? { type: breadcrumb.type } : {}),
    ...(typeof breadcrumb.category === 'string'
      ? { category: scrubString(breadcrumb.category) }
      : {}),
    ...(typeof breadcrumb.level === 'string' ? { level: breadcrumb.level } : {}),
    ...(typeof breadcrumb.timestamp === 'number'
      ? { timestamp: breadcrumb.timestamp }
      : {}),
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function scrubEventTags(value: unknown): Record<string, string> {
  const tags = asRecord(value)
  if (!tags) return {}
  const safe: Record<string, string> = {}
  for (const [key, entry] of Object.entries(tags)) {
    if (!ALLOWED_EVENT_TAGS.has(key)) continue
    if (
      typeof entry !== 'string' &&
      typeof entry !== 'number' &&
      typeof entry !== 'boolean'
    ) {
      continue
    }
    safe[key] = scrubString(String(entry)).slice(0, 200)
  }
  return safe
}

function scrubEventContexts(value: unknown): Record<string, Record<string, unknown>> {
  const contexts = asRecord(value)
  if (!contexts) return {}
  const safe: Record<string, Record<string, unknown>> = {}
  for (const [contextName, allowedFields] of Object.entries(ALLOWED_CONTEXT_FIELDS)) {
    const context = asRecord(contexts[contextName])
    if (!context) continue
    const safeContext: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(context)) {
      if (!allowedFields.has(key)) continue
      if (typeof entry === 'string') safeContext[key] = scrubString(entry).slice(0, 200)
      else if (typeof entry === 'number' || typeof entry === 'boolean') {
        safeContext[key] = entry
      }
    }
    if (Object.keys(safeContext).length > 0) safe[contextName] = safeContext
  }
  return safe
}

function scrubExceptionMechanism(value: unknown): void {
  const mechanism = asRecord(value)
  if (!mechanism) return
  delete mechanism.data
  delete mechanism.meta
}

function scrubStacktrace(value: unknown): void {
  const stacktrace = asRecord(value)
  if (!stacktrace || !Array.isArray(stacktrace.frames)) return
  for (const frame of stacktrace.frames) {
    const frameRecord = asRecord(frame)
    if (!frameRecord) continue
    delete frameRecord.vars
    delete frameRecord.pre_context
    delete frameRecord.context_line
    delete frameRecord.post_context
    delete frameRecord.abs_path
  }
}

function deeplyScrub(obj: unknown, seen: WeakMap<object, unknown>): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') return scrubString(obj)
  if (typeof obj !== 'object') return obj
  const existing = seen.get(obj)
  if (existing) return existing

  if (Array.isArray(obj)) {
    const result: unknown[] = []
    seen.set(obj, result)
    for (const item of obj) result.push(deeplyScrub(item, seen))
    return result
  }

  const result: Record<string, unknown> = {}
  seen.set(obj, result)
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = isSensitiveObservabilityField(key) ? REDACTED : deeplyScrub(value, seen)
  }
  return result
}

// ── Runtime configuration ──────────────────────────────────────────

function isDeployedProductionCell(env: ObservabilityEnvironment): boolean {
  return (
    env.NODE_ENV === 'production' &&
    typeof env.RAILWAY_ENVIRONMENT_NAME === 'string' &&
    env.RAILWAY_ENVIRONMENT_NAME.startsWith('cell-')
  )
}

function assertGermanyIngestionDsn(dsn: string): void {
  const hostname = new URL(dsn).hostname.toLowerCase()
  if (hostname !== 'ingest.de.sentry.io' && !hostname.endsWith('.ingest.de.sentry.io')) {
    throw new Error(
      '[CONFIG] SENTRY_DSN must use the Sentry Germany ingestion host (*.ingest.de.sentry.io)',
    )
  }
}

export function buildObservabilityConfig(
  service: ObservabilityService,
  env: ObservabilityEnvironment = observabilityEnvironmentSchema.parse(process.env),
): ObservabilityConfig {
  if (isDeployedProductionCell(env) && !env.SENTRY_DSN) {
    throw new Error(
      '[CONFIG] SENTRY_DSN is required for every deployed production Data Cell',
    )
  }
  if (env.NODE_ENV === 'production' && env.SENTRY_DSN) {
    assertGermanyIngestionDsn(env.SENTRY_DSN)
  }

  return {
    service,
    dsn: env.SENTRY_DSN,
    environment: env.RAILWAY_ENVIRONMENT_NAME ?? env.NODE_ENV,
    release: env.RELEASE_SHA ?? env.RAILWAY_GIT_COMMIT_SHA ?? 'unknown',
    processingCell: env.PROCESSING_CELL,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  }
}

// ── Provider-neutral runtime ───────────────────────────────────────

function nonErrorFailure(error: unknown): Error {
  return error instanceof Error ? error : new Error('Non-Error failure')
}

const MACHINE_TAG_VALUE = /^[a-z0-9][a-z0-9_.:-]{0,79}$/u

function machineTag(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return MACHINE_TAG_VALUE.test(value) ? value : 'unknown'
}

export function createErrorMonitor(deps: {
  readonly sentry: ErrorMonitoringSdk
  readonly logger: ErrorMonitoringLogger | (() => ErrorMonitoringLogger)
}): ErrorMonitor {
  let state: ObservabilityInitResult | undefined
  let activeSdk: ErrorMonitoringSdk | undefined
  const logger = () => (typeof deps.logger === 'function' ? deps.logger() : deps.logger)
  const log = (
    level: 'info' | 'warn' | 'error',
    obj: Record<string, unknown>,
    message: string,
  ): void => {
    try {
      logger()[level](obj, message)
    } catch {
      // The preload must not depend on the application's full environment
      // parser: monitoring initializes first precisely so later boot failures
      // can be captured. Emit only the fixed message when structured logging
      // is not available yet; never serialize the object or original error.
      try {
        process.stderr.write(`[observability:${level}] ${message}\n`)
      } catch {
        // An unavailable diagnostic sink must never change process behavior.
      }
    }
  }

  return {
    initialize(config) {
      if (state) return state
      if (!config.dsn) {
        state = 'disabled'
        log(
          'info',
          { service: config.service },
          'Error monitoring disabled outside a deployed production Data Cell',
        )
        return state
      }

      try {
        if (!deps.sentry.isInitialized()) {
          deps.sentry.init({
            dsn: config.dsn,
            environment: config.environment,
            release: config.release,
            tracesSampleRate: config.tracesSampleRate,
            sendDefaultPii: false,
            includeLocalVariables: false,
            serverName: `repkey-${config.service}`,
            // RepKey owns worker process-fatal drain/exit semantics. Sentry's
            // default handlers would duplicate captures and race that owner;
            // web retains them because it has no equivalent fatal owner. Local
            // variables/source context are excluded for data minimization.
            integrations: (defaults) =>
              defaults.filter(
                (integration) =>
                  (config.service !== 'worker' ||
                    (integration.name !== 'OnUncaughtException' &&
                      integration.name !== 'OnUnhandledRejection')) &&
                  integration.name !== 'LocalVariablesAsync' &&
                  integration.name !== 'ContextLines',
              ),
            beforeSend: scrubSentryEvent,
            beforeSendTransaction: scrubSentryEvent,
            beforeBreadcrumb: scrubSentryBreadcrumb,
          })
        }
        activeSdk = deps.sentry
        activeSdk.setTags({
          service: config.service,
          processing_cell: config.processingCell,
          release_sha: config.release,
        })
        state = 'enabled'
        log(
          'info',
          {
            service: config.service,
            environment: config.environment,
            processingCell: config.processingCell,
            releaseSha: config.release,
            tracesSampleRate: config.tracesSampleRate,
          },
          'Error monitoring initialized',
        )
        return state
      } catch (err) {
        activeSdk = undefined
        state = 'failed'
        log(
          'error',
          { err, service: config.service },
          'Error monitoring initialization failed — application startup continues',
        )
        return state
      }
    },

    captureException(error, context) {
      if (!activeSdk) return
      try {
        const queue = machineTag(context.queue)
        const jobName = machineTag(context.jobName)
        activeSdk.captureException(nonErrorFailure(error), {
          tags: {
            runtime_source: context.source,
            ...(context.trigger ? { termination_trigger: context.trigger } : {}),
            ...(queue ? { queue } : {}),
            ...(jobName ? { job_name: jobName } : {}),
          },
        })
      } catch (err) {
        log('warn', { err }, 'Error monitoring capture failed')
      }
    },

    async flush(timeoutMs = ERROR_MONITOR_FLUSH_BUDGET_MS) {
      if (!activeSdk) return true
      try {
        const flushed = await activeSdk.flush(timeoutMs)
        if (!flushed) {
          log(
            'warn',
            { timeoutMs },
            'Error monitoring flush timed out before delivery completed',
          )
        }
        return flushed
      } catch (err) {
        log('warn', { err, timeoutMs }, 'Error monitoring flush failed')
        return false
      }
    },
  }
}

const processMonitor = createErrorMonitor({
  sentry: Sentry as unknown as ErrorMonitoringSdk,
  logger: getLogger,
})

export function initObservability(
  service: ObservabilityService,
): ObservabilityInitResult {
  return processMonitor.initialize(buildObservabilityConfig(service))
}

export function captureObservabilityException(
  error: unknown,
  context: ErrorCaptureContext,
): void {
  processMonitor.captureException(error, context)
}

export function flushObservability(
  timeoutMs = ERROR_MONITOR_FLUSH_BUDGET_MS,
): Promise<boolean> {
  return processMonitor.flush(timeoutMs)
}
