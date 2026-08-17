import type { InternalMtlsWebServer } from '../internal-mtls'

export type AiGatewayAsyncDisposable = Readonly<{
  close?(): Promise<void> | void
  destroy?(): void
}>

export type AiGatewayStagedCleanupSources = Readonly<{
  server(): Pick<InternalMtlsWebServer, 'stopAndDrain'> | undefined
  asyncDisposables(): readonly AiGatewayAsyncDisposable[]
  sensitiveDisposables(): readonly Readonly<{ dispose(): void }>[]
  sensitiveBuffers(): readonly Uint8Array[]
}>

export function createAiGatewayStagedCleanup(
  sources: AiGatewayStagedCleanupSources,
): () => Promise<void> {
  let cleanup: Promise<void> | null = null
  return () => {
    if (cleanup !== null) return cleanup
    cleanup = (async () => {
      const server = sources.server()
      const asyncDisposables = [...sources.asyncDisposables()]
      const sensitiveDisposables = [...sources.sensitiveDisposables()]
      const sensitiveBuffers = [...sources.sensitiveBuffers()]
      let failure: unknown = null
      try {
        await server?.stopAndDrain()
      } catch (error) {
        failure = error
      }
      for (const disposable of asyncDisposables) {
        try {
          await disposable.close?.()
        } catch (error) {
          failure ??= error
          try {
            disposable.destroy?.()
          } catch (destroyError) {
            failure ??= destroyError
          }
        }
      }
      for (const disposable of sensitiveDisposables) {
        try {
          disposable.dispose()
        } catch (error) {
          failure ??= error
        }
      }
      for (const buffer of sensitiveBuffers) {
        try {
          buffer.fill(0)
        } catch (error) {
          failure ??= error
        }
      }
      if (failure !== null) throw failure
    })()
    return cleanup
  }
}

export function createAiGatewayShutdown(
  input: Readonly<{
    server: Pick<InternalMtlsWebServer, 'stopAndDrain'>
    admissionTransport: AiGatewayAsyncDisposable
    sensitiveBuffers: readonly Uint8Array[]
    sensitiveDisposables: readonly Readonly<{ dispose(): void }>[]
    asyncDisposables?: readonly AiGatewayAsyncDisposable[]
  }>,
): () => Promise<void> {
  return createAiGatewayStagedCleanup({
    server: () => input.server,
    asyncDisposables: () => [input.admissionTransport, ...(input.asyncDisposables ?? [])],
    sensitiveDisposables: () => input.sensitiveDisposables,
    sensitiveBuffers: () => input.sensitiveBuffers,
  })
}
