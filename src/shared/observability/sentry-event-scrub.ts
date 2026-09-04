import { isSensitiveObservabilityField } from './sensitive-field-policy'

const REDACTED = '[REDACTED]'

const ALLOWED_EVENT_TAGS: Readonly<Record<string, true>> = {
  service: true,
  processing_cell: true,
  release_sha: true,
  runtime_source: true,
  termination_trigger: true,
  queue: true,
  job_name: true,
  feedback_type: true,
  feedback_impact: true,
  feedback_route: true,
  feedback_actor: true,
  feedback_organization: true,
  feedback_viewport: true,
  feedback_role: true,
  feedback_reference: true,
  feedback_attachment: true,
  feedback_attachment_retention: true,
  feedback_triage_state: true,
  feedback_triage_owner: true,
  feedback_triage_severity: true,
  feedback_triage_privacy: true,
  feedback_triage_security: true,
  feedback_triage_reproduction: true,
  feedback_triage_dedupe: true,
  feedback_customer_response: true,
}

const ALLOWED_CONTEXT_FIELDS: Readonly<Record<string, Readonly<Record<string, true>>>> = {
  app: { app_name: true, app_version: true, app_build: true },
  device: {
    arch: true,
    brand: true,
    family: true,
    model: true,
    model_id: true,
  },
  os: { name: true, version: true, kernel_version: true },
  response: { status_code: true },
  runtime: { name: true, version: true },
  trace: {
    trace_id: true,
    span_id: true,
    parent_span_id: true,
    op: true,
    origin: true,
    status: true,
  },
}

const OPERATIONAL_TRANSACTION_EXCLUSIONS: Readonly<Record<string, true>> = {
  '/health/live': true,
  '/health/ready': true,
  '/api/health/started': true,
  '/api/health/live': true,
  '/api/health/ready': true,
  '/api/health/metrics': true,
}

export interface SentryBreadcrumb {
  readonly type?: string
  readonly category?: string
  readonly level?: string
  readonly timestamp?: number
  readonly message?: string
  readonly data?: Record<string, unknown>
}

const PII_STRING_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  /\bBearer\s+[^\s]+/giu,
  /\bpostgres(?:ql)?:\/\/[^\s/@:]+:[^\s/@]+@/giu,
  /\bredis(?:s)?:\/\/[^\s/@:]+:[^\s/@]+@/giu,
  /\/[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?=\/|\?|#|$)/giu,
  /([?&](?:token|key|code|secret|password|email)=)[^&#\s]+/giu,
  /(\b(?:token|secret|password|api[_-]?key)\s*[:=]\s*)[^\s,;]+/giu,
]

export function scrubString(value: string): string {
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

  if ('tags' in record) record.tags = scrubSentryTags(record.tags)
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
export function scrubSentryEvent<T>(event: T): T {
  if (!event || typeof event !== 'object') return event
  const scrubbed = deeplyScrub(event, new WeakMap<object, unknown>())
  if (!scrubbed || typeof scrubbed !== 'object' || Array.isArray(scrubbed)) {
    return scrubbed as T
  }

  const record = scrubbed as Record<string, unknown>
  if (record.type === 'feedback') return scrubSentryFeedbackRecord(record) as T

  scrubEventEnvelope(record)
  scrubEventExceptions(record)
  scrubEventThreads(record)

  if (Array.isArray(record.breadcrumbs)) {
    record.breadcrumbs = record.breadcrumbs.map((breadcrumb) =>
      scrubSentryBreadcrumb(asRecord(breadcrumb) ?? {}),
    )
  }

  scrubEventSpans(record)

  return scrubbed as T
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
export function filterAndScrubSentryTransaction<T>(event: T): T | null {
  const record = asRecord(event)
  const request = asRecord(record?.request)
  const paths = [transactionPath(record?.transaction), transactionPath(request?.url)]
  if (
    paths.some(
      (path) => path !== undefined && OPERATIONAL_TRANSACTION_EXCLUSIONS[path] === true,
    )
  ) {
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

  record.tags = scrubSentryTags(record.tags)
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
export function scrubSentryBreadcrumb<T extends SentryBreadcrumb>(breadcrumb: T): T {
  return {
    ...(typeof breadcrumb.type === 'string' ? { type: breadcrumb.type } : {}),
    ...(typeof breadcrumb.category === 'string'
      ? { category: scrubString(breadcrumb.category) }
      : {}),
    ...(typeof breadcrumb.level === 'string' ? { level: breadcrumb.level } : {}),
    ...(typeof breadcrumb.timestamp === 'number'
      ? { timestamp: breadcrumb.timestamp }
      : {}),
  } as T
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function scrubSentryTags(value: unknown): Record<string, string> {
  const tags = asRecord(value)
  if (!tags) return {}
  const safe: Record<string, string> = {}
  for (const [key, entry] of Object.entries(tags)) {
    if (ALLOWED_EVENT_TAGS[key] !== true) continue
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
      if (allowedFields[key] !== true) continue
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
