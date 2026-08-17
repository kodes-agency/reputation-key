import { resolve } from 'node:path'
import { connect as tlsConnect } from 'node:tls'
import { fileURLToPath } from 'node:url'
import { assertRuntimeEgressProbeEnvironmentIsIsolated } from './environment'

export type RuntimeEgressDestinationId =
  | 'openai-control'
  | 'dns-sentinel'
  | 'direct-ip-sentinel'
export type RuntimeEgressProbeErrorClass =
  | 'none'
  | 'dns'
  | 'tcp'
  | 'tls'
  | 'timeout'
  | 'unknown'
export type RuntimeEgressElapsedBucket =
  | 'under_100ms'
  | '100_to_499ms'
  | '500_to_999ms'
  | '1s_to_4999ms'
  | 'timeout'

export type RuntimeTlsAttempt = Readonly<{
  destinationId: RuntimeEgressDestinationId
  host: string
  port: number
  servername: string
  timeoutMillis: number
}>

export type RuntimeTlsAttemptResult = Readonly<{
  attempted: true
  tcpConnected: boolean
  tlsAuthorized: boolean
  elapsedMillis: number
  errorClass: RuntimeEgressProbeErrorClass
}>

export type RuntimeEgressProbeConfig = Readonly<{
  releaseSha: string
  imageDigest: string
  region: string
}>

export type RuntimeEgressProbeEvidence = Readonly<{
  releaseSha: string
  imageDigest: string
  region: string
  attempts: readonly Readonly<{
    destinationId: RuntimeEgressDestinationId
    attempted: true
    tcpConnected: boolean
    tlsAuthorized: boolean
    elapsedMillisBucket: RuntimeEgressElapsedBucket
    errorClass: RuntimeEgressProbeErrorClass
  }>[]
  controlReachable: boolean
  arbitraryEgressReachable: boolean
}>

const DESTINATIONS: readonly RuntimeTlsAttempt[] = Object.freeze([
  Object.freeze({
    destinationId: 'openai-control',
    host: 'api.openai.com',
    port: 443,
    servername: 'api.openai.com',
    timeoutMillis: 5_000,
  }),
  Object.freeze({
    destinationId: 'dns-sentinel',
    host: 'example.com',
    port: 443,
    servername: 'example.com',
    timeoutMillis: 5_000,
  }),
  Object.freeze({
    destinationId: 'direct-ip-sentinel',
    host: '1.1.1.1',
    port: 443,
    servername: 'one.one.one.one',
    timeoutMillis: 5_000,
  }),
])

function elapsedBucket(elapsedMillis: number): RuntimeEgressElapsedBucket {
  if (elapsedMillis >= 5_000) return 'timeout'
  if (elapsedMillis < 100) return 'under_100ms'
  if (elapsedMillis < 500) return '100_to_499ms'
  if (elapsedMillis < 1_000) return '500_to_999ms'
  return '1s_to_4999ms'
}

function classifyTlsError(
  error: unknown,
  tcpConnected: boolean,
): RuntimeEgressProbeErrorClass {
  if (!(error instanceof Error)) return 'unknown'
  const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
  if (code === 'ETIMEDOUT') return 'timeout'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns'
  return tcpConnected ? 'tls' : 'tcp'
}

export async function attemptRawTls(
  input: RuntimeTlsAttempt,
  options: Readonly<{ trustedCa?: string | Buffer }> = {},
): Promise<RuntimeTlsAttemptResult> {
  if (
    input.host.length === 0 ||
    input.servername.length === 0 ||
    !Number.isSafeInteger(input.port) ||
    input.port < 1 ||
    input.port > 65_535 ||
    !Number.isSafeInteger(input.timeoutMillis) ||
    input.timeoutMillis < 1 ||
    input.timeoutMillis > 5_000
  ) {
    throw new TypeError('Runtime TLS attempt is invalid')
  }
  const startedAt = performance.now()
  return await new Promise((resolveAttempt) => {
    let settled = false
    let tcpConnected = false
    let socket: ReturnType<typeof tlsConnect> | undefined
    const finish = (
      result: Omit<RuntimeTlsAttemptResult, 'attempted' | 'elapsedMillis'>,
    ) => {
      if (settled) return
      settled = true
      clearTimeout(wallDeadline)
      socket?.destroy()
      resolveAttempt({
        attempted: true,
        ...result,
        elapsedMillis: Math.min(
          input.timeoutMillis,
          Math.max(0, performance.now() - startedAt),
        ),
      })
    }
    const wallDeadline = setTimeout(() => {
      finish({ tcpConnected, tlsAuthorized: false, errorClass: 'timeout' })
    }, input.timeoutMillis)
    try {
      socket = tlsConnect({
        host: input.host,
        port: input.port,
        servername: input.servername,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        ...(options.trustedCa === undefined ? {} : { ca: options.trustedCa }),
      })
      socket.once('connect', () => {
        tcpConnected = true
      })
      socket.once('secureConnect', () => {
        finish({
          tcpConnected: true,
          tlsAuthorized: socket?.authorized === true,
          errorClass: socket?.authorized === true ? 'none' : 'tls',
        })
      })
      socket.once('error', (error) => {
        finish({
          tcpConnected,
          tlsAuthorized: false,
          errorClass: classifyTlsError(error, tcpConnected),
        })
      })
    } catch (error) {
      finish({
        tcpConnected,
        tlsAuthorized: false,
        errorClass: classifyTlsError(error, tcpConnected),
      })
    }
  })
}

export function parseRuntimeEgressProbeEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): RuntimeEgressProbeConfig {
  assertRuntimeEgressProbeEnvironmentIsIsolated(environment)
  const releaseSha = environment.AI_EGRESS_PROBE_RELEASE_SHA
  const imageDigest = environment.AI_EGRESS_PROBE_IMAGE_DIGEST
  const region = environment.AI_EGRESS_PROBE_REGION
  if (
    !releaseSha ||
    !/^[0-9a-f]{40}$/.test(releaseSha) ||
    !imageDigest ||
    !/^sha256:[0-9a-f]{64}$/.test(imageDigest) ||
    !region ||
    !/^[a-z0-9][a-z0-9-]{0,31}$/.test(region)
  ) {
    throw new Error('Runtime egress probe environment is invalid')
  }
  return Object.freeze({ releaseSha, imageDigest, region })
}

export async function runRuntimeEgressCapabilityProbe(
  config: RuntimeEgressProbeConfig,
  dependencies: Readonly<{
    attemptTls?: (input: RuntimeTlsAttempt) => Promise<RuntimeTlsAttemptResult>
  }> = {},
): Promise<RuntimeEgressProbeEvidence> {
  const attemptTls = dependencies.attemptTls ?? attemptRawTls
  const results: RuntimeEgressProbeEvidence['attempts'][number][] = []
  for (const destination of DESTINATIONS) {
    const result = await attemptTls(destination)
    results.push(
      Object.freeze({
        destinationId: destination.destinationId,
        attempted: true,
        tcpConnected: result.tcpConnected,
        tlsAuthorized: result.tlsAuthorized,
        elapsedMillisBucket: elapsedBucket(result.elapsedMillis),
        errorClass: result.errorClass,
      }),
    )
  }
  const controlReachable = results[0]?.tlsAuthorized === true
  const arbitraryEgressReachable =
    results[1]?.tlsAuthorized === true || results[2]?.tlsAuthorized === true
  return Object.freeze({
    ...config,
    attempts: Object.freeze(results),
    controlReachable,
    arbitraryEgressReachable,
  })
}

export function isRuntimeEgressProbeEntrypoint(
  argvEntry = process.argv[1],
  moduleUrl = import.meta.url,
): boolean {
  if (!argvEntry) return false
  try {
    return resolve(argvEntry) === resolve(fileURLToPath(moduleUrl))
  } catch {
    return false
  }
}

if (isRuntimeEgressProbeEntrypoint()) {
  const evidence = await runRuntimeEgressCapabilityProbe(
    parseRuntimeEgressProbeEnvironment(process.env),
  )
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
  if (!evidence.controlReachable || !evidence.arbitraryEgressReachable)
    process.exitCode = 1
}
