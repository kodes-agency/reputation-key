import type { GoogleAuthorizedProviderExecutor } from '../../application/ports/google-authorized-provider-executor.port'

export function createSingle401RefreshExecutor(
  deps: Readonly<{
    executor: GoogleAuthorizedProviderExecutor
    refreshAccessToken: (
      input: Readonly<{
        authorization: Parameters<
          GoogleAuthorizedProviderExecutor['execute']
        >[1]['authorization']
      }>,
    ) => Promise<unknown>
    getAccessToken: (
      input: Readonly<{
        authorization: Parameters<
          GoogleAuthorizedProviderExecutor['execute']
        >[1]['authorization']
      }>,
    ) => Promise<string>
    reauthorize: (
      input: Readonly<{
        authorization: Parameters<
          GoogleAuthorizedProviderExecutor['execute']
        >[1]['authorization']
      }>,
    ) => Promise<
      Parameters<GoogleAuthorizedProviderExecutor['execute']>[1]['authorization']
    >
  }>,
): GoogleAuthorizedProviderExecutor {
  const inFlightByConnection = new Map<string, Promise<void>>()

  const refresh = (
    authorization: Parameters<
      GoogleAuthorizedProviderExecutor['execute']
    >[1]['authorization'],
  ): Promise<void> => {
    const key = `${authorization.organizationId}\u0000${authorization.connectionId}`
    const current = inFlightByConnection.get(key)
    if (current) return current

    const started = deps.refreshAccessToken({ authorization }).then(() => undefined)
    inFlightByConnection.set(key, started)
    const remove = () => {
      if (inFlightByConnection.get(key) === started) inFlightByConnection.delete(key)
    }
    void started.then(remove, remove)
    return started
  }

  const sameScope = (
    current: Parameters<GoogleAuthorizedProviderExecutor['execute']>[1]['authorization'],
    refreshed: Parameters<
      GoogleAuthorizedProviderExecutor['execute']
    >[1]['authorization'],
  ): boolean =>
    current.capability === refreshed.capability &&
    current.organizationId === refreshed.organizationId &&
    current.propertyId === refreshed.propertyId &&
    current.connectionId === refreshed.connectionId &&
    current.initiatorUserId === refreshed.initiatorUserId

  return Object.freeze({
    execute: async (descriptor, options) => {
      const first = await deps.executor.execute(descriptor, options)
      if (!first.ok || first.status !== 401 || !('accessToken' in descriptor))
        return first
      first.body.fill(0)
      await refresh(options.authorization)
      options.signal?.throwIfAborted()
      const authorization = await deps.reauthorize({
        authorization: options.authorization,
      })
      options.signal?.throwIfAborted()
      if (!sameScope(options.authorization, authorization)) {
        throw new Error('refreshed Google authorization scope changed')
      }
      const accessToken = await deps.getAccessToken({ authorization })
      options.signal?.throwIfAborted()
      if (accessToken.length < 1 || accessToken.length > 8_192) {
        throw new Error('refreshed Google access token is invalid')
      }
      return deps.executor.execute(
        Object.freeze({ ...descriptor, accessToken }),
        Object.freeze({ ...options, authorization }),
      )
    },
  })
}
