// The shared Redis client's command deadline, against a real loopback socket.
//
// The stand-in speaks just enough of the Redis protocol for ioredis to connect
// and answer a few commands, and can go silent while the connection stays open:
// the failure a refused or closed connection never shows.

import { createServer, type AddressInfo, type Server, type Socket } from 'node:net'
import { performance } from 'node:perf_hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRateLimiter } from '#/shared/rate-limit/middleware'
import { getRedis } from './redis'

const endpoint = vi.hoisted(() => ({ url: '' }))
vi.mock('#/shared/config/env', () => ({
  getEnv: () => ({ REDIS_URL: endpoint.url, NODE_ENV: 'test' }),
}))
vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({ warn: vi.fn(), error: vi.fn() }),
}))

const COMMAND_DEADLINE_MS = 2_000
const SILENCE_BUDGET_MS = 2_500
const TEST_TIMEOUT_MS = 10_000

/** The next whole command in `text` as its arguments, and how much text it used. */
function takeCommand(text: string): { args: string[]; used: number } | undefined {
  const header = /^\*(\d+)\r\n/.exec(text)
  if (!header) return undefined
  const args: string[] = []
  let at = header[0].length
  for (let n = Number(header[1]); n > 0; n -= 1) {
    const size = /^\$(\d+)\r\n/.exec(text.slice(at))
    if (!size) return undefined
    const start = at + size[0].length
    const end = start + Number(size[1])
    if (text.length < end + 2) return undefined
    args.push(text.slice(start, end))
    at = end + 2
  }
  return { args, used: at }
}

function replyTo(args: readonly string[]): string {
  switch (args[0]?.toLowerCase()) {
    case 'info':
      return '$11\r\nloading:0\r\n\r\n'
    case 'ping':
      return '+PONG\r\n'
    case 'eval':
    case 'ttl':
      return ':1\r\n'
    default:
      return '+OK\r\n'
  }
}

type StandIn = Readonly<{ silence(): void; stop(): Promise<void> }>

async function startStandIn(): Promise<StandIn> {
  const sockets = new Set<Socket>()
  let silent = false
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => undefined)
    let pending = ''
    socket.on('data', (data) => {
      pending += data.toString('latin1')
      for (let next = takeCommand(pending); next; next = takeCommand(pending)) {
        pending = pending.slice(next.used)
        if (!silent) socket.write(replyTo(next.args))
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  endpoint.url = `redis://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    silence: () => {
      silent = true
    },
    stop: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}

const REDIS_KEY = Symbol.for('repkey.shared.cache.redis')
const sharedClient = () =>
  (globalThis as Record<symbol, { disconnect(): void } | undefined>)[REDIS_KEY]

describe('shared Redis client commands', () => {
  let standIn: StandIn

  beforeEach(async () => {
    standIn = await startStandIn()
  })

  afterEach(async () => {
    sharedClient()?.disconnect()
    delete (globalThis as Record<symbol, unknown>)[REDIS_KEY]
    await standIn.stop()
  })

  it('lets the first command wait for the connection and succeed', async () => {
    const redis = getRedis()!

    expect(redis.status).toBe('wait')
    await expect(redis.ping()).resolves.toBe('PONG')
  })

  it(
    'times out a command on a connection that accepts and never answers',
    async () => {
      standIn.silence()
      const started = performance.now()

      await expect(getRedis()!.ping()).rejects.toThrow('Command timed out')

      const waited = performance.now() - started
      expect(waited).toBeGreaterThanOrEqual(COMMAND_DEADLINE_MS - 100)
      expect(waited).toBeLessThan(SILENCE_BUDGET_MS)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'makes a rate limiter refuse when a working connection stops answering',
    async () => {
      const redis = getRedis()!
      await expect(redis.ping()).resolves.toBe('PONG')
      standIn.silence()
      const limiter = createRateLimiter(redis, {
        keyPrefix: 'unit',
        maxRequests: 1,
        windowSeconds: 60,
        failClosed: true,
      })
      const started = performance.now()

      await expect(limiter.check('caller')).resolves.toMatchObject({
        allowed: false,
        remaining: 0,
        backendStatus: 'unavailable',
      })

      expect(performance.now() - started).toBeLessThan(SILENCE_BUDGET_MS)
    },
    TEST_TIMEOUT_MS,
  )
})
