// Error redaction — B0.7 boundary hardening.
//
// Translates any thrown value into a safe public { message, code } pair,
// never exposing stack traces, DB details, provider info, or PII. Tagged
// domain errors (IntegrationError, GoalError, DomainError, …) preserve their
// stable code and a PII-redacted message; everything else collapses to a
// generic 'internal_error' so raw stacks, SQL, connection strings, and
// provider names can never reach the client.

/** Safe, client-facing error shape. */
export interface RedactedError {
  readonly message: string
  readonly code: string
}

// ── PII / secret redaction patterns ──────────────────────────────────
// Applied to messages that pass through from tagged errors. These strip
// common PII and secret patterns so a poorly-worded domain message can't
// accidentally leak an email, token, or connection string to the client.

function buildPatterns(): readonly { pattern: RegExp; label: string }[] {
  return [
    {
      // URLs with embedded credentials: https://user:pass@host
      pattern: /[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@[^\s/]+/gi,
      label: '[redacted-url]',
    },
    {
      // Tokens and secrets: Bearer xxx, token=xxx, api_key=xxx
      pattern: /(?:Bearer\s+|token=|api[_-]?key=|password=|secret=)[^\s&]+/gi,
      label: '[redacted]',
    },
    {
      // Email addresses
      pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/g,
      label: '[redacted-email]',
    },
    {
      // UUIDs — must run BEFORE phone to avoid partial matches on hex digits
      pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      label: '[redacted-id]',
    },
    {
      // Phone numbers — run AFTER UUID so hex digit groups aren't matched
      pattern: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
      label: '[redacted-phone]',
    },
  ]
}

const REDACTION_RULES = buildPatterns()

function redactMessage(message: string): string {
  let result = message
  for (const rule of REDACTION_RULES) {
    result = result.replace(rule.pattern, rule.label)
  }
  return result.trim()
}

// Known tagged-error types that carry a stable `code`. These are the only
// errors whose message is surfaced to the client (after PII redaction).
// Unknown errors always get a generic message.
const KNOWN_ERROR_TAGS: Readonly<Record<string, true>> = {
  DomainError: true,
  IntegrationError: true,
  GoalError: true,
  DashboardError: true,
  PortalError: true,
  ReviewError: true,
  InboxError: true,
  ServerError: true,
  APIError: true,
  AuthError: true,
}

interface TaggedErrorShape {
  readonly _tag: string
  readonly code: string
  readonly message?: unknown
}

function isTaggedError(e: unknown): e is TaggedErrorShape {
  return (
    e !== null &&
    typeof e === 'object' &&
    '_tag' in e &&
    typeof (e as Record<string, unknown>)._tag === 'string' &&
    'code' in e &&
    typeof (e as Record<string, unknown>).code === 'string'
  )
}

/**
 * Redact an unknown thrown value into a safe public { message, code } pair.
 *
 * - Tagged errors with a known `_tag` preserve their `code` and a PII-redacted
 *   version of their message.
 * - Everything else (plain Error, DB exceptions, provider failures, primitives)
 *   returns a generic message + 'internal_error' code — never exposing stack
 *   traces, SQL, connection strings, provider names, or internal details.
 */
export function redactError(error: unknown): RedactedError {
  if (isTaggedError(error) && KNOWN_ERROR_TAGS[error._tag] === true) {
    const rawMessage = typeof error.message === 'string' ? error.message : ''
    return {
      message: redactMessage(rawMessage) || 'Request could not be completed.',
      code: error.code,
    }
  }

  return {
    message: 'Something went wrong. Please try again.',
    code: 'internal_error',
  }
}
