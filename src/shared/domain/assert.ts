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
