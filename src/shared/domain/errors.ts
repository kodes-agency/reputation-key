// Base tagged error shape — conventions for error handling across all contexts.
// Authoritative layer table: src/contexts/CONTEXT.md § Error pattern (BQR-1.2).
//
// Every domain/application error is a real Error carrying this enumerable shape:
//   Error & { _tag: 'XxxError', code: '<reason>', context?: Readonly<Record<string, unknown>> }
//
// Errors are built via smart constructors (e.g., portalError, reviewError).
// Domain pure functions prefer Result<T, XxxError>. Application layer throws.
// Domain assert helpers may throw the same tagged shape only (never plain Error / untagged { code }).
// Server functions catch tagged errors and pattern-match on _tag/code → HTTP.
//
// Per conventions:
// - No plain Error in domain/application for business failures.
// - Prefer Result in pure domain; throw tagged errors at the application boundary.
// - Tagged business failures are real Error instances so transports, logs, and stacks work.
// - Server functions translate tagged errors to HTTP (throwContextError).

export type TaggedError<
  Tag extends string = string,
  Code extends string = string,
> = Readonly<{
  _tag: Tag
  code: Code
  message: string
  context?: Readonly<Record<string, unknown>>
}>

const defineEnumerable = <T>(value: T): PropertyDescriptor => ({
  value,
  enumerable: true,
  writable: false,
  configurable: false,
})

type TaggedErrorExtras = Readonly<Record<string, unknown>>

const RESERVED_ERROR_KEYS = new Set([
  'name',
  'message',
  'stack',
  'cause',
  '_tag',
  'code',
  'context',
])

function assertSafeExtraKeys(extras: TaggedErrorExtras): void {
  for (const key of Object.keys(extras)) {
    if (RESERVED_ERROR_KEYS.has(key)) {
      throw new TypeError(`Tagged error extra cannot override reserved field: ${key}`)
    }
  }
}

function buildTaggedError<
  Tag extends string,
  Code extends string,
  Extras extends TaggedErrorExtras,
>(
  tag: Tag,
  code: Code,
  message: string,
  context: Readonly<Record<string, unknown>> | undefined,
  extras: Extras,
  stackStart: (...args: never[]) => unknown,
): Error & TaggedError<Tag, Code> & Extras {
  assertSafeExtraKeys(extras)
  const error = new Error(message) as Error & TaggedError<Tag, Code> & Extras
  Object.defineProperties(error, {
    name: defineEnumerable(tag),
    _tag: defineEnumerable(tag),
    code: defineEnumerable(code),
    ...(context ? { context: defineEnumerable(context) } : {}),
    ...Object.fromEntries(
      Object.entries(extras).map(([key, value]) => [key, defineEnumerable(value)]),
    ),
  })
  if ('captureStackTrace' in Error && typeof Error.captureStackTrace === 'function') {
    Error.captureStackTrace(error, stackStart)
  }
  return error
}

/** Build a throwable tagged Error with optional enumerable context and extra identity. */
export function createTaggedError<
  Tag extends string,
  Code extends string,
  Extras extends TaggedErrorExtras = Readonly<Record<never, never>>,
>(
  tag: Tag,
  code: Code,
  message: string,
  context?: Readonly<Record<string, unknown>>,
  extras = {} as Extras,
  stackStart: (...args: never[]) => unknown = createTaggedError,
): Error & TaggedError<Tag, Code> & Extras {
  return buildTaggedError(tag, code, message, context, extras, stackStart)
}

/** Create a closed-code tagged Error constructor for a specific context. */
export function createErrorFactory<Tag extends string, Code extends string = string>(
  tag: Tag,
) {
  const factory = (
    code: Code,
    message: string,
    context?: Readonly<Record<string, unknown>>,
  ): Error & TaggedError<Tag, Code> =>
    buildTaggedError(tag, code, message, context, {}, factory)
  return factory
}

// ── DomainError — shared/domain invariant & lookup failures ──────────
// Standard tagged-error runtime shape: a real Error instance — so `instanceof Error`
// holds, a stack trace is captured,
// and log serializers render it correctly — carrying the tagged DomainError shape
// as enumerable properties. Discriminated at catch sites via `_tag === 'DomainError'`.
// Used by shared/domain assert/assertLiteral guards and roles/permissions lookups for
// impossible-state and lookup failures that previously threw plain `new Error()`.
export type DomainError = Readonly<{
  _tag: 'DomainError'
  code: string
  message: string
  context?: Readonly<Record<string, unknown>>
}>

/** Build a tagged DomainError that is also a real Error (stack + instanceof). */
export const domainError = (
  code: string,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): Error & DomainError =>
  buildTaggedError('DomainError', code, message, context, {}, domainError)

export const isDomainError = (e: unknown): e is DomainError =>
  typeof e === 'object' && e !== null && '_tag' in e && e._tag === 'DomainError'
