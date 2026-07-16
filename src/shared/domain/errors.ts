// Base tagged error shape — conventions for error handling across all contexts.
// Authoritative layer table: src/contexts/CONTEXT.md § Error pattern (BQR-1.2).
//
// Every domain error follows this shape:
//   { _tag: 'XxxError', code: '<reason>', message: string, context?: Readonly<Record<string, unknown>> }
//
// Errors are built via smart constructors (e.g., portalError, reviewError).
// Domain pure functions prefer Result<T, XxxError>. Application layer throws.
// Domain assert helpers may throw the same tagged shape only (never plain Error / untagged { code }).
// Server functions catch tagged errors and pattern-match on _tag/code → HTTP.
//
// Per conventions:
// - No plain Error in domain/application for business failures.
// - Prefer Result in pure domain; throw tagged errors at the application boundary.
// - ADR 0005 hybrid (Error & tagged) is allowed for stack/logging where needed (e.g. integration).
// - Server functions translate tagged errors to HTTP (throwContextError).

// fallow-ignore-next-line unused-type
export type TaggedError<
  Tag extends string = string,
  Code extends string = string,
> = Readonly<{
  _tag: Tag
  code: Code
  message: string
  context?: Readonly<Record<string, unknown>>
}>

/** Create a tagged error constructor for a specific error type. */
export function createErrorFactory<Tag extends string>(tag: Tag) {
  return <Code extends string>(
    code: Code,
    message: string,
    context?: Readonly<Record<string, unknown>>,
  ): TaggedError<Tag, Code> => ({
    _tag: tag,
    code,
    message,
    ...(context ? { context } : {}),
  })
}

// ── DomainError — shared/domain invariant & lookup failures ──────────
// ADR 0005 hybrid pattern (same as contexts/integration/domain/errors.ts):
// a real Error instance — so `instanceof Error` holds, a stack trace is captured,
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

const defineEnumerable = <T>(value: T): PropertyDescriptor => ({
  value,
  enumerable: true,
  writable: false,
  configurable: false,
})

/** Build a tagged DomainError that is also a real Error (stack + instanceof). */
export const domainError = (
  code: string,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): Error & DomainError => {
  const err = new Error(message) as Error & DomainError
  Object.defineProperties(err, {
    name: defineEnumerable('DomainError'),
    _tag: defineEnumerable('DomainError'),
    code: defineEnumerable(code),
    ...(context ? { context: defineEnumerable(context) } : {}),
  })
  if ('captureStackTrace' in Error && typeof Error.captureStackTrace === 'function') {
    Error.captureStackTrace(err, domainError)
  }
  return err
}

export const isDomainError = (e: unknown): e is DomainError =>
  typeof e === 'object' && e !== null && '_tag' in e && e._tag === 'DomainError'
