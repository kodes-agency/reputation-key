const LOCAL_STACK_EXECUTION_IDENTITY = 'repkey-local-stack-v1'

/**
 * The command runs only on the host and is absent from every serving image.
 * This guard also requires the committed e2e environment to claim its narrow
 * fixture-seeding identity explicitly.
 */
export function assertLocalToolExecutionIdentity(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (environment.LOCAL_TOOL_EXECUTION_IDENTITY !== LOCAL_STACK_EXECUTION_IDENTITY) {
    throw new Error(
      'Local-only command refused: the e2e host execution identity is missing or invalid',
    )
  }
}
