import { readFile } from 'node:fs/promises'
import { createPrivateKey } from 'node:crypto'
import { once } from 'node:events'
import { createServer as createTcpServer } from 'node:net'
import { createServer as createTlsServer } from 'node:tls'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import {
  attemptRawTls,
  isRuntimeEgressProbeEntrypoint,
  parseRuntimeEgressProbeEnvironment,
  runRuntimeEgressCapabilityProbe,
  type RuntimeTlsAttempt,
} from './runtime-egress-probe'

const releaseSha = 'a'.repeat(40)
const imageDigest = `sha256:${'b'.repeat(64)}`

const TEST_CERT_DER_BASE64 =
  'MIIBtzCCAV2gAwIBAgIURlLEKEq8QMnReuBDr0jfPq77fecwCgYIKoZIzj0EAwIwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDgxNjE3MTMwNloXDTM2MDgxMzE3MTMwNlowFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEM0WPY8YwZPPEjbnm5V6ew88ldJ+r1nghPAyaTJlWqVEiWK/K7G2JABdA10yaOH7c07YyLFDogydv8tpDa74zbKOBjDCBiTAdBgNVHQ4EFgQUXj6uJWXxx8AtNLJZwhlQTT0BlrkwHwYDVR0jBBgwFoAUXj6uJWXxx8AtNLJZwhlQTT0BlrkwDwYDVR0TAQH/BAUwAwEB/zAUBgNVHREEDTALgglsb2NhbGhvc3QwCwYDVR0PBAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMAoGCCqGSM49BAMCA0gAMEUCIQDnmwrk4BdXliCeyz79ecrnQJHbwvCV9PLuSxON00xw3gIgVOi1tcPcaLDolTvzb8vLLUWTWma5RfyRiEMIxdGxSMw='
const TEST_KEY_DER_BASE64 =
  'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgdJ+5iAcRMRndF/sSYhw17vACCGNzQcIpdzwGUrtLBNShRANCAAQzRY9jxjBk88SNueblXp7DzyV0n6vWeCE8DJpMmVapUSJYr8rsbYkAF0DXTJo4ftzTtjIsUOiDJ2/y2kNrvjNs'

function certificatePem(): string {
  const lines = TEST_CERT_DER_BASE64.match(/.{1,64}/gu)
  if (lines === null) throw new Error('test certificate fixture is invalid')
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`
}

async function listenOnLoopback(
  server: ReturnType<typeof createTcpServer> | ReturnType<typeof createTlsServer>,
): Promise<number> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('test server address is unavailable')
  }
  return address.port
}

async function closeServer(
  server: ReturnType<typeof createTcpServer> | ReturnType<typeof createTlsServer>,
): Promise<void> {
  server.close()
  await once(server, 'close')
}
describe('runtime egress capability probe', () => {
  it('attempts only the three fixed raw-TLS destinations and emits closed evidence', async () => {
    const attempts: RuntimeTlsAttempt[] = []
    const evidence = await runRuntimeEgressCapabilityProbe(
      { releaseSha, imageDigest, region: 'us-west' },
      {
        attemptTls: vi.fn(async (input) => {
          attempts.push(input)
          return Object.freeze({
            attempted: true as const,
            tcpConnected: true,
            tlsAuthorized: input.destinationId !== 'direct-ip-sentinel',
            elapsedMillis: 42,
            errorClass: input.destinationId === 'direct-ip-sentinel' ? 'tls' : 'none',
          })
        }),
      },
    )
    expect(attempts).toEqual([
      {
        destinationId: 'openai-control',
        host: 'api.openai.com',
        port: 443,
        servername: 'api.openai.com',
        timeoutMillis: 5_000,
      },
      {
        destinationId: 'dns-sentinel',
        host: 'example.com',
        port: 443,
        servername: 'example.com',
        timeoutMillis: 5_000,
      },
      {
        destinationId: 'direct-ip-sentinel',
        host: '1.1.1.1',
        port: 443,
        servername: 'one.one.one.one',
        timeoutMillis: 5_000,
      },
    ])
    expect(evidence.arbitraryEgressReachable).toBe(true)
    expect(evidence.attempts).toHaveLength(3)
    expect(JSON.stringify(evidence)).not.toMatch(
      /address|certificate|header|body|environment/i,
    )
  })

  it('fails the posture result when the provider control or both sentinels fail', async () => {
    const allFailed = await runRuntimeEgressCapabilityProbe(
      { releaseSha, imageDigest, region: 'us-west' },
      {
        attemptTls: async () => ({
          attempted: true,
          tcpConnected: false,
          tlsAuthorized: false,
          elapsedMillis: 5_000,
          errorClass: 'timeout',
        }),
      },
    )
    expect(allFailed.controlReachable).toBe(false)
    expect(allFailed.arbitraryEgressReachable).toBe(false)
  })

  it('records arbitrary sentinel reachability independently from the provider control', async () => {
    const evidence = await runRuntimeEgressCapabilityProbe(
      { releaseSha, imageDigest, region: 'us-west' },
      {
        attemptTls: async (input) => ({
          attempted: true,
          tcpConnected: input.destinationId === 'dns-sentinel',
          tlsAuthorized: input.destinationId === 'dns-sentinel',
          elapsedMillis: 42,
          errorClass: input.destinationId === 'dns-sentinel' ? 'none' : 'timeout',
        }),
      },
    )
    expect(evidence.controlReachable).toBe(false)
    expect(evidence.arbitraryEgressReachable).toBe(true)
  })

  it('accepts only the build-isolated probe environment', () => {
    expect(
      parseRuntimeEgressProbeEnvironment({
        AI_EGRESS_PROBE_RELEASE_SHA: releaseSha,
        AI_EGRESS_PROBE_IMAGE_DIGEST: imageDigest,
        AI_EGRESS_PROBE_REGION: 'eu-west',
        PORT: '8080',
      }),
    ).toEqual({ releaseSha, imageDigest, region: 'eu-west' })
    for (const [name, value] of [
      ['OPENAI_API_KEY', 'forbidden'],
      ['OPENAI_BASE_URL', 'https://example.invalid'],
      ['AI_INTERNAL_MTLS_CA_B64', 'forbidden'],
      ['AI_INTERNAL_MTLS_CERT_B64', 'forbidden'],
      ['AI_REQUEST_BINDING_HMAC_KEYS', 'forbidden'],
      ['AI_SAFETY_IDENTIFIER_HMAC_KEYS', 'forbidden'],
      ['AI_EGRESS_GATEWAY_ORIGIN', 'forbidden'],
      ['DATABASE_URL', 'forbidden'],
      ['PROVIDER_REDIS_URL', 'forbidden'],
      ['PROPERTY_ID', 'forbidden'],
    ] as const) {
      expect(() =>
        parseRuntimeEgressProbeEnvironment({
          AI_EGRESS_PROBE_RELEASE_SHA: releaseSha,
          AI_EGRESS_PROBE_IMAGE_DIGEST: imageDigest,
          AI_EGRESS_PROBE_REGION: 'eu-west',
          [name]: value,
        }),
      ).toThrow()
    }
  })

  it('recognizes only the exact executed module path', () => {
    const modulePath = resolve('/tmp/dist-ai-egress-probe/runtime-egress-probe.js')
    expect(
      isRuntimeEgressProbeEntrypoint(modulePath, pathToFileURL(modulePath).href),
    ).toBe(true)
    expect(
      isRuntimeEgressProbeEntrypoint(
        resolve('/tmp/runtime-egress-probe.js'),
        pathToFileURL(modulePath).href,
      ),
    ).toBe(false)
    expect(
      isRuntimeEgressProbeEntrypoint(undefined, pathToFileURL(modulePath).href),
    ).toBe(false)
  })

  it('performs all three attempts as authorized raw TLS handshakes against a controlled endpoint', async () => {
    const cert = certificatePem()
    const key = createPrivateKey({
      key: Buffer.from(TEST_KEY_DER_BASE64, 'base64'),
      format: 'der',
      type: 'pkcs8',
    }).export({ format: 'pem', type: 'pkcs8' })
    let actualAttempts = 0
    const server = createTlsServer({ key, cert, minVersion: 'TLSv1.2' }, (socket) => {
      socket.end()
    })
    const port = await listenOnLoopback(server)
    try {
      const evidence = await runRuntimeEgressCapabilityProbe(
        { releaseSha, imageDigest, region: 'local-test' },
        {
          attemptTls: (input) => {
            actualAttempts += 1
            return attemptRawTls(
              {
                ...input,
                host: '127.0.0.1',
                port,
                servername: 'localhost',
                timeoutMillis: 1_000,
              },
              { trustedCa: cert },
            )
          },
        },
      )
      expect(evidence.controlReachable).toBe(true)
      expect(evidence.arbitraryEgressReachable).toBe(true)
      expect(evidence.attempts).toEqual([
        expect.objectContaining({
          destinationId: 'openai-control',
          attempted: true,
          tcpConnected: true,
          tlsAuthorized: true,
          errorClass: 'none',
        }),
        expect.objectContaining({
          destinationId: 'dns-sentinel',
          attempted: true,
          tcpConnected: true,
          tlsAuthorized: true,
          errorClass: 'none',
        }),
        expect.objectContaining({
          destinationId: 'direct-ip-sentinel',
          attempted: true,
          tcpConnected: true,
          tlsAuthorized: true,
          errorClass: 'none',
        }),
      ])
      expect(actualAttempts).toBe(3)
      expect(JSON.stringify(evidence)).not.toContain(TEST_CERT_DER_BASE64)
    } finally {
      await closeServer(server)
    }
  })

  it('enforces the wall deadline against a TCP peer that never completes TLS', async () => {
    const sockets = new Set<import('node:net').Socket>()
    const server = createTcpServer((socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
    })
    const port = await listenOnLoopback(server)
    const wallStartedAt = performance.now()
    try {
      const result = await attemptRawTls({
        destinationId: 'openai-control',
        host: '127.0.0.1',
        port,
        servername: 'localhost',
        timeoutMillis: 50,
      })
      expect(result).toMatchObject({
        attempted: true,
        tcpConnected: true,
        tlsAuthorized: false,
        errorClass: 'timeout',
      })
      expect(result.elapsedMillis).toBeGreaterThanOrEqual(0)
      expect(result.elapsedMillis).toBeLessThanOrEqual(50)
      expect(performance.now() - wallStartedAt).toBeLessThan(500)
    } finally {
      for (const socket of sockets) socket.destroy()
      await closeServer(server)
    }
  })
  it('uses an independent wall deadline rather than socket inactivity timeout', async () => {
    const source = await readFile(
      new URL('./runtime-egress-probe.ts', import.meta.url),
      'utf8',
    )
    expect(source).toContain('wallDeadline = setTimeout')
    expect(source).toContain('clearTimeout(wallDeadline)')
    expect(source).not.toContain('socket.setTimeout')
  })
})
