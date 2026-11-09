// Telemetry sanitizing — pure helpers with no Node dependencies, shared by the
// logger, tracing and the Storybook logger stub.
import { isSensitiveObservabilityField } from '#/shared/observability/sensitive-field-policy'
import { summarizeError } from './error-summary'

const REDACTED = '[Redacted]'

/**
 * What a flattened error leaves behind: its stack opens with the message, and
 * a Drizzle query error carries the values it was bound to as `params`.
 */
const ERROR_CONTENT_FIELDS: ReadonlySet<string> = new Set([
  'message',
  'errormessage',
  'failurereason',
  'stack',
  'params',
])

function sanitizeErrorField(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value instanceof Error) return summarizeError(value)
  if (value && typeof value === 'object' && 'message' in value) {
    const status = 'status' in value ? value.status : undefined
    return {
      ...summarizeError(value),
      ...(typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
        ? { status }
        : {}),
    }
  }
  return typeof value === 'string' ? REDACTED : sanitizeTelemetryValue(value, seen)
}

function sanitizeTelemetryField(
  key: string,
  value: unknown,
  seen: WeakMap<object, unknown>,
): unknown {
  const field = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '')
  if (isSensitiveObservabilityField(key) || ERROR_CONTENT_FIELDS.has(field)) {
    return REDACTED
  }
  if (field === 'error' || field === 'err') return sanitizeErrorField(value, seen)
  return sanitizeTelemetryValue(value, seen)
}

/**
 * Copies telemetry data while removing credential, OAuth, provider-resource,
 * request-body, URL/query, referrer, and session material at any nesting
 * depth. It intentionally matches field names rather than value substrings so
 * harmless code-only fields remain observable. An error becomes its allowlisted
 * summary (error-summary.ts), never its message or stack.
 */
export function sanitizeTelemetryValue(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (value instanceof Error) return summarizeError(value)
  if (Array.isArray(value)) {
    const existing = seen.get(value)
    if (existing) return existing
    const copy: unknown[] = []
    seen.set(value, copy)
    for (const item of value) copy.push(sanitizeTelemetryValue(item, seen))
    return copy
  }
  if (value && typeof value === 'object') {
    const existing = seen.get(value)
    if (existing) return existing
    const copy: Record<string, unknown> = {}
    seen.set(value, copy)
    for (const [key, entry] of Object.entries(value)) {
      copy[key] = sanitizeTelemetryField(key, entry, seen)
    }
    return copy
  }
  return value
}

export function normalizeTelemetryPath(value: string): string {
  try {
    return new URL(value, 'https://telemetry.invalid').pathname
  } catch {
    return value.split(/[?#]/u, 1)[0] || '/'
  }
}
