import { assertSeparatedPlatformHealthPort } from './platform-health'

function parsePort(raw: string, description: string): number {
  if (!/^[1-9][0-9]{0,4}$/u.test(raw)) {
    throw new Error(`${description} port is invalid`)
  }
  const port = Number(raw)
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new Error(`${description} port is invalid`)
  }
  return port
}

export function resolveSidecarRuntimePorts(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<{ healthPort: number; protectedMtlsPort: number }> {
  const healthPort = parsePort(environment.PORT ?? '8080', 'sidecar platform health')
  const protectedMtlsPort = parsePort(
    environment.INTERNAL_MTLS_PORT ?? '8443',
    'sidecar protected mTLS',
  )
  assertSeparatedPlatformHealthPort(healthPort, protectedMtlsPort)
  return Object.freeze({ healthPort, protectedMtlsPort })
}
