import type { GoogleAuthorizedProviderExecutor } from '../../application/ports/google-authorized-provider-executor.port'

export function createSingle401RefreshExecutor(
  deps: Readonly<{
    executor: GoogleAuthorizedProviderExecutor
    refreshAccessToken: (input: Readonly<{ signal?: AbortSignal }>) => Promise<string>
  }>,
): GoogleAuthorizedProviderExecutor {
  return Object.freeze({
    execute: async (descriptor, options) => {
      const first = await deps.executor.execute(descriptor, options)
      if (!first.ok || first.status !== 401) return first

      first.body.fill(0)
      const accessToken = await deps.refreshAccessToken({ signal: options.signal })
      return deps.executor.execute(Object.freeze({ ...descriptor, accessToken }), options)
    },
  })
}
