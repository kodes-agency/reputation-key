const LOCAL_STACK_EXECUTION_IDENTITY = 'repkey-local-stack-v1'

/**
 * Defense in depth for destructive fixture/provisioning executables.
 *
 * The primary control is artifact isolation: these commands are absent from
 * every serving image. This guard prevents a copied local-tools bundle from
 * doing work unless the local stack explicitly claims its narrow identity.
 */
export function assertLocalToolExecutionIdentity(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (environment.LOCAL_TOOL_EXECUTION_IDENTITY !== LOCAL_STACK_EXECUTION_IDENTITY) {
    throw new Error(
      'Local-only command refused: the local-stack execution identity is missing or invalid',
    )
  }
}
