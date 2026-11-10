const CONCURRENT_QUERY_WARNING =
  'Calling client.query() when the client is already executing a query is deprecated'

export function createPgQueryWarningGuard() {
  const warnings: Error[] = []
  return {
    onWarning(warning: Error): void {
      if (
        warning.name === 'DeprecationWarning' &&
        warning.message.startsWith(CONCURRENT_QUERY_WARNING)
      ) {
        warnings.push(warning)
      }
    },
    assertNoWarnings(): void {
      if (warnings.length > 0) {
        throw new AggregateError(
          warnings.splice(0),
          'PostgreSQL queries overlapped on a single client; await each query before starting another',
        )
      }
    },
  }
}
