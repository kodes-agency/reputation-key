import { describe, expect, it, vi } from 'vitest'
import { createAiGatewayShutdown, createAiGatewayStagedCleanup } from './shutdown'

describe('AI gateway shutdown', () => {
  it('stops ingress and drains in-flight handlers before destroying admission sockets and zeroing keys', async () => {
    const events: string[] = []
    let releaseDrain!: () => void
    const drain = new Promise<void>((resolve) => {
      releaseDrain = resolve
    })
    const server = {
      stopAndDrain: vi.fn(async () => {
        events.push('stop-and-drain')
        await drain
        events.push('drained')
      }),
    }
    const admissionTransport = {
      close: vi.fn(() => {
        events.push('transport-closed')
      }),
    }
    const sensitiveDisposable = {
      dispose: vi.fn(() => {
        events.push('keyring-disposed')
      }),
    }
    const safetyKey = Buffer.from('11'.repeat(32), 'hex')
    const tlsKey = Buffer.from('secret')
    const shutdown = createAiGatewayShutdown({
      server,
      admissionTransport,
      sensitiveBuffers: [safetyKey, tlsKey],
      sensitiveDisposables: [sensitiveDisposable],
    })

    const pending = shutdown()
    await Promise.resolve()
    expect(server.stopAndDrain).toHaveBeenCalledOnce()
    expect(admissionTransport.close).not.toHaveBeenCalled()
    expect(safetyKey.some((byte) => byte !== 0)).toBe(true)
    expect(tlsKey.some((byte) => byte !== 0)).toBe(true)

    releaseDrain()
    await pending
    expect(events).toEqual([
      'stop-and-drain',
      'drained',
      'transport-closed',
      'keyring-disposed',
    ])
    expect([...safetyKey]).toEqual(Array(32).fill(0))
    expect([...tlsKey]).toEqual(Array(6).fill(0))
  })

  it('is idempotent when multiple shutdown signals arrive', async () => {
    const server = { stopAndDrain: vi.fn(async () => undefined) }
    const admissionTransport = { close: vi.fn() }
    const key = Buffer.from('secret')
    const shutdown = createAiGatewayShutdown({
      server,
      admissionTransport,
      sensitiveBuffers: [key],
      sensitiveDisposables: [],
    })

    await Promise.all([shutdown(), shutdown()])
    expect(server.stopAndDrain).toHaveBeenCalledOnce()
    expect(admissionTransport.close).toHaveBeenCalledOnce()
    expect([...key]).toEqual(Array(6).fill(0))
  })

  it('destroys failing async resources and still clears every sensitive allocation', async () => {
    const connector = {
      close: vi.fn(async () => {
        throw new Error('connector close failed')
      }),
      destroy: vi.fn(),
    }
    const admissionTransport = {
      close: vi.fn(async () => {
        throw new Error('admission close failed')
      }),
      destroy: vi.fn(),
    }
    const disposable = {
      dispose: vi.fn(() => {
        throw new Error('dispose failed')
      }),
    }
    const key = Buffer.from('secret')
    const shutdown = createAiGatewayShutdown({
      server: {
        stopAndDrain: vi.fn(async () => {
          throw new Error('drain failed')
        }),
      },
      admissionTransport,
      sensitiveBuffers: [key],
      sensitiveDisposables: [disposable],
      asyncDisposables: [connector],
    })

    await expect(shutdown()).rejects.toThrow('drain failed')
    expect(admissionTransport.close).toHaveBeenCalledOnce()
    expect(admissionTransport.destroy).toHaveBeenCalledOnce()
    expect(connector.close).toHaveBeenCalledOnce()
    expect(connector.destroy).toHaveBeenCalledOnce()
    expect(disposable.dispose).toHaveBeenCalledOnce()
    expect([...key]).toEqual(Array(6).fill(0))
  })

  it.each([
    ['tls', 1],
    ['keyring', 2],
    ['transport', 3],
    ['connector', 4],
    ['server-readiness', 5],
  ] as const)(
    'cleans every resource allocated before a %s construction failure',
    async (_name, stage) => {
      const tls = Buffer.from('tls-secret')
      const dispose = vi.fn()
      const transportClose = vi.fn()
      const connectorClose = vi.fn()
      const serverDrain = vi.fn()
      let allocatedStage = 0
      const cleanup = createAiGatewayStagedCleanup({
        server: () => (allocatedStage >= 5 ? { stopAndDrain: serverDrain } : undefined),
        asyncDisposables: () => [
          ...(allocatedStage >= 3 ? [{ close: transportClose }] : []),
          ...(allocatedStage >= 4 ? [{ close: connectorClose }] : []),
        ],
        sensitiveDisposables: () => (allocatedStage >= 2 ? [{ dispose }] : []),
        sensitiveBuffers: () => (allocatedStage >= 1 ? [tls] : []),
      })

      allocatedStage = stage
      await cleanup()
      expect([...tls]).toEqual(Array(tls.byteLength).fill(0))
      expect(dispose).toHaveBeenCalledTimes(stage >= 2 ? 1 : 0)
      expect(transportClose).toHaveBeenCalledTimes(stage >= 3 ? 1 : 0)
      expect(connectorClose).toHaveBeenCalledTimes(stage >= 4 ? 1 : 0)
      expect(serverDrain).toHaveBeenCalledTimes(stage >= 5 ? 1 : 0)
      await cleanup()
      expect(dispose).toHaveBeenCalledTimes(stage >= 2 ? 1 : 0)
    },
  )
})
