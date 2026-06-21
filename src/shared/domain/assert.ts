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
