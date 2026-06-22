// Exhaustive-never assertion for switch/match exhaustiveness checking.
// Use in default branches where TypeScript should prove the value is `never`.

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
    throw new Error(`Invalid ${label}: ${value}`)
  }
  return value as T
}

/**
 * Pure runtime assertion. No Node builtins — safe for the domain layer.
 * Use to guard invariants that the type system cannot express.
 * Throws a plain Error (not node:assert) so domain code stays portable.
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}
