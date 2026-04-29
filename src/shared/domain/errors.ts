// Base tagged error shape — conventions for error handling across all contexts.
//
// Every domain error follows this shape:
//   { _tag: 'XxxError', code: '<reason>', message: string, context?: Readonly<Record<string, unknown>> }
//
// Errors are built via smart constructors (e.g., portalError, reviewError).
// Domain functions return Result<T, DomainError>. Application layer throws.
// Server functions catch tagged errors and pattern-match on _tag/code → HTTP.
//
// Per conventions:
// - No throw in domain; return Result instead.
// - Throw tagged errors at the application boundary.
// - Server functions translate tagged errors to HTTP using match().exhaustive().
// - No plain Error objects. Ever.

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
