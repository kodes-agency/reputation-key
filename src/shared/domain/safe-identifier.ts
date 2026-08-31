/**
 * Transport/log-safe grammar for bounded opaque identifiers.
 *
 * This is deliberately a predicate, not a domain-ID constructor: accepting a
 * value here proves only that it is bounded and contains no whitespace/control
 * characters. It does not prove that the identifier exists or belongs to any
 * tenant or aggregate.
 */
export const SAFE_OPAQUE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:@/-]{1,255}$/u

export const isSafeOpaqueIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && SAFE_OPAQUE_IDENTIFIER_PATTERN.test(value)
