// The refusal type shared by every test-environment guard.
//
// It lives alone so guards can import it without importing each other:
// test-environment-lease.ts calls into configured-database-fence.ts, and the
// fence raises this error, which would otherwise be an import cycle.

export class TestEnvironmentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'TestEnvironmentError'
  }
}
