// Privacy-safe server error monitoring for the web and BullMQ worker processes.
//
// The production images preload this module before their application entry so
// Sentry can install its supported Node ESM instrumentation before framework,
// database, queue, and HTTP modules are evaluated. Runtime callers bind to the
// already-initialized SDK, capture only errors plus a tiny metadata allowlist,
// and flush through the existing bounded shutdown paths.
//
// Monitoring is an operational control, not optional product analytics. A
// deployed Railway Data Cell therefore refuses a missing DSN or one outside the pinned Sentry region.
// SDK/transport failures still fail open: an observability vendor outage must
// never turn into a RepKey application outage.

import * as Sentry from '@sentry/node'
import { z } from 'zod/v4'
import {
  BETA_FEEDBACK_ATTACHMENT_RETENTION_DAYS,
  type MaskedLayoutSnapshot,
} from '#/shared/beta-feedback-contract'
import { renderMaskedLayoutSvg } from '#/shared/masked-layout-snapshot'
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
  'feedback_type',
  'feedback_impact',
  'feedback_route',
  'feedback_actor',
  'feedback_organization',
  'feedback_viewport',
  'feedback_role',
  'feedback_reference',
  'feedback_attachment',
  'feedback_attachment_retention',
  'feedback_triage_state',
  'feedback_triage_owner',
  'feedback_triage_severity',
  'feedback_triage_privacy',
  'feedback_triage_security',
  'feedback_triage_reproduction',
  'feedback_triage_dedupe',
  'feedback_customer_response',
])

const ALLOWED_CONTEXT_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  app: new Set(['app_name', 'app_version', 'app_build']),
  device: new Set(['arch', 'brand', 'family', 'model', 'model_id']),
  os: new Set(['name', 'version', 'kernel_version']),
  response: new Set(['status_code']),
  runtime: new Set(['name', 'version']),
  trace: new Set(['trace_id', 'span_id', 'parent_span_id', 'op', 'origin', 'status']),
}

const OPERATIONAL_TRANSACTION_EXCLUSIONS = new Set([
  '/health/live',
  '/health/ready',
  '/api/health/started',
  '/api/health/live',
  '/api/health/ready',
  '/api/health/metrics',
])

export type ObservabilityService =
  | 'web'
  | 'worker'
  | 'google-execution-admission'
  | 'google-egress-gateway'
  | 'ai-execution-admission'
  | 'ai-egress-gateway'
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
  captureFeedback(
    params: FeedbackCaptureParams,
    hint?: FeedbackCaptureHint,
    scope?: FeedbackCaptureScope,
  ): string
  withScope(callback: (scope: FeedbackCaptureScope) => unknown): unknown
  withIsolationScope(callback: (scope: FeedbackCaptureScope) => unknown): unknown
  flush(timeoutMs: number): Promise<boolean>
}

export interface FeedbackCaptureScope {
  clear(): unknown
  addEventProcessor(processor: (event: unknown) => unknown): unknown
}

interface ErrorMonitoringLogger {
  info(obj: Record<string, unknown>, message: string): void
  warn(obj: Record<string, unknown>, message: string): void
  error(obj: Record<string, unknown>, message: string): void
}

export interface ErrorCaptureContext {
  readonly source:
    | 'nitro'
    | 'worker-process'
    | 'worker-startup'
    | 'bullmq-worker'
    | 'bullmq-job'
    | 'sidecar-process'
    | 'sidecar-startup'
    | 'sidecar-dependency'
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

export interface FeedbackCaptureParams {
  readonly message: string
  readonly source: 'repkey-native-beta-feedback'
  readonly tags: Readonly<Record<string, string>>
  readonly maskedLayoutAttachment?: Readonly<{
    readonly capturedAt: string
    readonly expiresAt: string
    readonly snapshot: MaskedLayoutSnapshot
  }>
}

export interface FeedbackCaptureHint {
  readonly includeReplay: false
  readonly attachments?: ReadonlyArray<{
    readonly data: Uint8Array
    readonly filename: 'repkey-masked-layout.svg'
    readonly contentType: 'image/svg+xml'
  }>
}

export interface ErrorMonitor {
  initialize(config: ObservabilityConfig): ObservabilityInitResult
  captureException(error: unknown, context: ErrorCaptureContext): void
  captureFeedback(params: FeedbackCaptureParams): string | undefined
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
  /(\b(?:token|secret|password|api[_-]?key)\s*[:=]\s*)[^\s,;]+/giu,
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
 * Structural denials on the event's own fields: the message and transaction are
 * redacted, unclassifiable containers are removed, and the request keeps only
 * its method.
 */
function scrubEventEnvelope(record: Record<string, unknown>): void {
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
}

function scrubEventExceptions(record: Record<string, unknown>): void {
  const exception = asRecord(record.exception)
  if (!exception || !Array.isArray(exception.values)) return
  for (const value of exception.values) {
    const exceptionValue = asRecord(value)
    if (!exceptionValue) continue
    if ('value' in exceptionValue) exceptionValue.value = REDACTED
    scrubExceptionMechanism(exceptionValue.mechanism)
    scrubStacktrace(exceptionValue.stacktrace)
  }
}

function scrubEventThreads(record: Record<string, unknown>): void {
  const threads = asRecord(record.threads)
  if (!threads || !Array.isArray(threads.values)) return
  for (const thread of threads.values) scrubStacktrace(asRecord(thread)?.stacktrace)
}

function scrubEventSpans(record: Record<string, unknown>): void {
  if (!Array.isArray(record.spans)) return
  for (const span of record.spans) {
    const spanRecord = asRecord(span)
    if (!spanRecord) continue
    if ('description' in spanRecord) spanRecord.description = REDACTED
    delete spanRecord.data
  }
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
  if (record.type === 'feedback') return scrubSentryFeedbackRecord(record)

  scrubEventEnvelope(record)
  scrubEventExceptions(record)
  scrubEventThreads(record)

  if (Array.isArray(record.breadcrumbs)) {
    record.breadcrumbs = record.breadcrumbs.map((breadcrumb) =>
      scrubSentryBreadcrumb(asRecord(breadcrumb) ?? {}),
    )
  }

  scrubEventSpans(record)

  return scrubbed
}

function transactionPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const withoutMethod = value.replace(
    /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\s+/u,
    '',
  )
  try {
    return new URL(withoutMethod, 'https://observability.invalid').pathname
  } catch {
    return undefined
  }
}

/**
 * Health and private metrics polling are operational control traffic rather
 * than product transactions. Drop those exact routes before sampling while
 * retaining ordinary application errors/transactions through the same strict
 * scrubber. Exact matching prevents an attacker-controlled lookalike route
 * from suppressing useful error evidence.
 */
export function filterAndScrubSentryTransaction(event: unknown): unknown {
  const record = asRecord(event)
  const request = asRecord(record?.request)
  const paths = [transactionPath(record?.transaction), transactionPath(request?.url)]
  if (paths.some((path) => path && OPERATIONAL_TRANSACTION_EXCLUSIONS.has(path))) {
    return null
  }
  return scrubSentryEvent(event)
}

function scrubSentryFeedbackRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  if ('message' in record) record.message = REDACTED
  if ('transaction' in record) record.transaction = REDACTED
  delete record.user
  delete record.extra
  delete record.attachments
  delete record.request
  delete record.fingerprint
  delete record.culprit
  delete record.logentry
  delete record.breadcrumbs
  delete record.spans
  delete record.threads
  delete record.exception

  record.tags = scrubEventTags(record.tags)
  const feedback = asRecord(asRecord(record.contexts)?.feedback)
  const message =
    typeof feedback?.message === 'string'
      ? scrubString(feedback.message).slice(0, 6_000)
      : ''
  record.contexts = message
    ? {
        feedback: {
          message,
          source:
            feedback?.source === 'repkey-native-beta-feedback'
              ? feedback.source
              : 'unknown',
        },
      }
    : {}
  return record
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

// The ingestion region is pinned so a DSN pasted from another Sentry region
// fails closed instead of silently shipping events somewhere else. The
// project lives in Sentry's US region (owner decision, 2026-09-04).
function assertUsIngestionDsn(dsn: string): void {
  const hostname = new URL(dsn).hostname.toLowerCase()
  if (hostname !== 'ingest.us.sentry.io' && !hostname.endsWith('.ingest.us.sentry.io')) {
    throw new Error(
      '[CONFIG] SENTRY_DSN must use the Sentry US ingestion host (*.ingest.us.sentry.io)',
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
    assertUsIngestionDsn(env.SENTRY_DSN)
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

const ATTACHMENT_RETENTION_MS =
  BETA_FEEDBACK_ATTACHMENT_RETENTION_DAYS * 24 * 60 * 60 * 1_000

function maskedLayoutHint(
  attachment: FeedbackCaptureParams['maskedLayoutAttachment'],
): FeedbackCaptureHint {
  if (!attachment) return { includeReplay: false }
  const capturedAt = Date.parse(attachment.capturedAt)
  const expiresAt = Date.parse(attachment.expiresAt)
  if (
    !Number.isFinite(capturedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= capturedAt ||
    expiresAt - capturedAt > ATTACHMENT_RETENTION_MS
  ) {
    throw new Error('Masked layout attachment has an invalid retention window')
  }
  const data = new TextEncoder().encode(renderMaskedLayoutSvg(attachment.snapshot))
  if (data.byteLength > 32_000) {
    throw new Error('Masked layout attachment exceeds the fixed byte budget')
  }
  return {
    includeReplay: false,
    attachments: [
      {
        data,
        filename: 'repkey-masked-layout.svg',
        contentType: 'image/svg+xml',
      },
    ],
  }
}

export function createErrorMonitor(deps: {
  readonly sentry: ErrorMonitoringSdk
  readonly logger: ErrorMonitoringLogger | (() => ErrorMonitoringLogger)
}): ErrorMonitor {
  let state: ObservabilityInitResult | undefined
  let activeSdk: ErrorMonitoringSdk | undefined
  let feedbackRuntimeTags: Readonly<Record<string, string>> | undefined
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
            // RepKey owns worker and sidecar process-fatal drain/exit
            // semantics. Sentry's default handlers would duplicate captures
            // and race that owner; web retains them because it has no
            // equivalent fatal owner. Replay stays globally absent. A
            // consented Bug may carry only the separately validated masked
            // layout SVG; it never enables an SDK Replay integration. Local
            // variables/source context are excluded for data minimization.
            integrations: (defaults) =>
              defaults.filter(
                (integration) =>
                  (config.service === 'web' ||
                    (integration.name !== 'OnUncaughtException' &&
                      integration.name !== 'OnUnhandledRejection')) &&
                  !integration.name?.startsWith('Replay') &&
                  integration.name !== 'LocalVariablesAsync' &&
                  integration.name !== 'ContextLines',
              ),
            beforeSend: scrubSentryEvent,
            beforeSendTransaction: filterAndScrubSentryTransaction,
            beforeBreadcrumb: scrubSentryBreadcrumb,
          })
        }
        activeSdk = deps.sentry
        feedbackRuntimeTags = {
          service: config.service,
          processing_cell: config.processingCell,
          release_sha: config.release,
        }
        activeSdk.setTags(feedbackRuntimeTags)
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
        feedbackRuntimeTags = undefined
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

    captureFeedback(params) {
      const sdk = activeSdk
      if (!sdk || !feedbackRuntimeTags) return undefined
      try {
        const scrubbedTags = scrubEventTags({
          ...feedbackRuntimeTags,
          ...params.tags,
        })
        const safeTags = Object.fromEntries(
          Object.entries(asRecord(scrubbedTags) ?? {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
        const safeParams: FeedbackCaptureParams = {
          message: scrubString(params.message).slice(0, 6_000),
          source: 'repkey-native-beta-feedback',
          tags: safeTags,
        }
        const safeHint = maskedLayoutHint(params.maskedLayoutAttachment)

        // Sentry 10.71 does not pass `type: "feedback"` events through the
        // ordinary `beforeSend` callback. Clear both inherited scopes so
        // request/user/breadcrumb/attachment state cannot hitchhike, then add
        // the feedback scrubber as the final scope processor (scope processors
        // run after client processors and merged scope data in this SDK).
        const reference = sdk.withIsolationScope((isolationScope) => {
          isolationScope.clear()
          return sdk.withScope((scope) => {
            scope.clear()
            scope.addEventProcessor(scrubSentryEvent)
            return sdk.captureFeedback(safeParams, safeHint, scope)
          })
        })
        return typeof reference === 'string' ? reference : undefined
      } catch (err) {
        log('warn', { err }, 'Beta feedback capture failed')
        return undefined
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

const preloadSafeLogger: ErrorMonitoringLogger = Object.freeze({
  info: (_object: Record<string, unknown>, message: string) => {
    process.stderr.write(
      `${JSON.stringify({ level: 'info', event: 'observability_diagnostic', message })}\n`,
    )
  },
  warn: (_object: Record<string, unknown>, message: string) => {
    process.stderr.write(
      `${JSON.stringify({ level: 'warn', event: 'observability_diagnostic', message })}\n`,
    )
  },
  error: (_object: Record<string, unknown>, message: string) => {
    process.stderr.write(
      `${JSON.stringify({ level: 'error', event: 'observability_diagnostic', message })}\n`,
    )
  },
})

const processMonitor = createErrorMonitor({
  sentry: Sentry as unknown as ErrorMonitoringSdk,
  // Monitoring is preloaded before the application environment parser and is
  // bundled into least-privileged sidecars. Keep this diagnostic sink
  // dependency-free and content-free; createErrorMonitor's public seam still
  // accepts the normal structured logger in unit tests and other embeddings.
  logger: preloadSafeLogger,
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

export function captureObservabilityFeedback(
  params: FeedbackCaptureParams,
): string | undefined {
  return processMonitor.captureFeedback(params)
}

export function flushObservability(
  timeoutMs = ERROR_MONITOR_FLUSH_BUDGET_MS,
): Promise<boolean> {
  return processMonitor.flush(timeoutMs)
}
