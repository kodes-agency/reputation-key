// Exhaustive-never assertion for switch/match exhaustiveness checking.
// Use in default branches where TypeScript should prove the value is `never`.
import { domainError } from './errors'

export class UnreachableError extends Error {
  constructor(location: string, value: never) {
    super(`Unreachable: unexpected value in ${location}: ${JSON.stringify(value)}`)
    this.name = 'UnreachableError'
  }
}

export function assertNever(location: string, value: never): never {
  throw new UnreachableError(location, value)
}

/**
 * Runtime validation that a string value belongs to a finite set of valid literals.
 * Use for DB row → literal-union mapping where varchar columns are cast to
 * domain types. Throws on invalid values instead of silently miscasting.
 */
export function assertLiteral<T extends string>(
  value: string,
  valid: readonly T[],
  label: string,
): T {
  if (!valid.includes(value as T)) {
    throw domainError('invalid_literal', `Invalid ${label}: ${value}`, {
      value,
      label,
      valid: [...valid],
    })
  }
  return value as T
}

/**
 * Pure runtime assertion. No Node builtins — safe for the domain layer.
 * Use to guard invariants that the type system cannot express.
 * Throws a typed DomainError (not node:assert) so domain code stays portable
 * while preserving a stack trace and the tagged-error contract.
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition)
    throw domainError('assertion_failed', `Assertion failed: ${message}`, { message })
}
