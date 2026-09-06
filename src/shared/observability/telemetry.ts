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
import {
  filterAndScrubSentryTransaction,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubSentryTags,
  scrubString,
  type SentryBreadcrumb,
} from './sentry-event-scrub'

const ERROR_MONITOR_FLUSH_BUDGET_MS = 1_500

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
    | 'alert-dispatcher'
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

// ── Runtime configuration ──────────────────────────────────────────

function isDeployedProductionCell(env: ObservabilityEnvironment): boolean {
  return (
    env.NODE_ENV === 'production' &&
    typeof env.RAILWAY_ENVIRONMENT_NAME === 'string' &&
    env.RAILWAY_ENVIRONMENT_NAME.length > 0
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
      '[CONFIG] SENTRY_DSN is required for every deployed Railway production environment',
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
          'Error monitoring disabled outside a deployed Railway production environment',
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
            // web retains them because it has no equivalent fatal owner.
            // Replay stays globally absent. A
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
        const safeTags = scrubSentryTags({
          ...feedbackRuntimeTags,
          ...params.tags,
        })
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
  // Monitoring is preloaded before the application environment parser. Keep
  // this diagnostic sink dependency-free and content-free;
  // createErrorMonitor's public seam still accepts the normal structured
  // logger in unit tests and other embeddings.
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
