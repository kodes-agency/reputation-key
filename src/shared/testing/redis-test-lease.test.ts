// Tests for the RedisTestLease guard (BQC-6.1).
// Verifies destructive queue operations cannot reach a shared/remote Redis,
// that an unavailable LOCAL Redis skips cleanly (bounded probe, no hang), and
// that REQUIRE_TEST_REDIS=1 turns the same unavailability into a failure — the
// arm CI's integration job sets so Redis-backed suites cannot pass unrun.
//
// The probe tests need no Redis: "unreachable" is a loopback port nothing
// listens on, and "reachable" is a stub that speaks just enough of the Redis
// protocol for the real ioredis client to connect and ping it.

import { readdirSync, readFileSync } from 'node:fs'
import { createServer, type AddressInfo, type Socket } from 'node:net'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { acquireRedisTestLease } from './redis-test-lease'
import { TestEnvironmentError } from './test-environment-lease'

// Save original env so we can restore after each test.
const originalEnv = { ...process.env }

const PONG = '+PONG\r\n'
const PING_REFUSED = '-ERR probe refused\r\n'
const INFO_BODY = 'redis_version:7.4.10\r\nloading:0\r\n'

/** A loopback port nothing listens on: the OS picks a free one, then it is released. */
async function closedLocalPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

/** Splits buffered Redis requests into command names; an incomplete request stays in `rest`. */
function takeCommandNames(buffered: string): { names: readonly string[]; rest: string } {
  const lines = buffered.split('\r\n')
  const names: string[] = []
  let cursor = 0
  for (;;) {
    const header = /^\*(\d+)$/u.exec(lines[cursor] ?? '')
    if (!header) break
    // A request is `*N` then N (length, value) line pairs, each line terminated.
    const next = cursor + 1 + Number(header[1]) * 2
    if (next >= lines.length) break
    names.push((lines[cursor + 2] ?? '').toUpperCase())
    cursor = next
  }
  return { names, rest: lines.slice(cursor).join('\r\n') }
}

function replyTo(command: string, pingReply: string): string {
  if (command === 'PING') return pingReply
  if (command === 'INFO') return `$${INFO_BODY.length}\r\n${INFO_BODY}\r\n`
  return '+OK\r\n' // the CLIENT SETINFO handshake
}

/**
 * The smallest server the real ioredis client accepts as a ready Redis: it
 * passes the INFO ready check and answers PING with `pingReply`.
 */
async function startRedisStub(
  pingReply: string,
): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    let pending = ''
    sockets.add(socket)
    socket.on('error', () => sockets.delete(socket))
    socket.on('close', () => sockets.delete(socket))
    socket.on('data', (chunk) => {
      const { names, rest } = takeCommandNames(pending + chunk.toString('latin1'))
      pending = rest
      for (const name of names) socket.write(replyTo(name, pingReply))
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  return {
    port,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((done) => server.close(() => done()))
    },
  }
}

describe('RedisTestLease (BQC-6.1)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = '1'
    delete process.env.ALLOW_REMOTE_TEST_DB
    delete process.env.REQUIRE_TEST_REDIS
  })

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key]
    }
    Object.assign(process.env, originalEnv)
  })

  describe('environment checks', () => {
    it('rejects when NODE_ENV is not test', async () => {
      process.env.NODE_ENV = 'development'
      await expect(acquireRedisTestLease('redis://localhost:6379')).rejects.toMatchObject(
        {
          code: 'not_test_env',
        },
      )
    })

    it('rejects when ALLOW_DESTRUCTIVE_DB_TESTS is not "1"', async () => {
      delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS
      await expect(acquireRedisTestLease('redis://localhost:6379')).rejects.toMatchObject(
        {
          code: 'not_opted_in',
        },
      )
    })
  })

  describe('guard refusals (before any connection attempt)', () => {
    it('refuses a managed Redis host (upstash)', async () => {
      await expect(
        acquireRedisTestLease('rediss://default:secret@fancy-123.upstash.io:6379'),
      ).rejects.toMatchObject({ code: 'denylisted_host' })
    })

    it('refuses a non-local host and names it', async () => {
      let error: unknown
      try {
        await acquireRedisTestLease('redis://cache.internal.example.com:6379')
      } catch (e) {
        error = e
      }
      expect(error).toBeInstanceOf(TestEnvironmentError)
      expect(error).toMatchObject({ code: 'remote_host_refused' })
      expect((error as Error).message).toContain('cache.internal.example.com')
    })

    it('still applies the denylist when ALLOW_REMOTE_TEST_DB=1', async () => {
      process.env.ALLOW_REMOTE_TEST_DB = '1'
      await expect(
        acquireRedisTestLease('rediss://default:secret@fancy-123.upstash.io:6379'),
      ).rejects.toMatchObject({ code: 'denylisted_host' })
    })

    it('rejects an invalid URL', async () => {
      await expect(acquireRedisTestLease('not-a-url')).rejects.toMatchObject({
        code: 'invalid_url',
      })
    })
  })

  describe('availability probe', () => {
    it('reports available=false against a dead local port when Redis is not required (bounded — no hang)', async () => {
      const lease = await acquireRedisTestLease('redis://localhost:5999')
      expect(lease.available).toBe(false)
      expect(lease.redis).toBeUndefined()
      lease.release()
    }, 15_000)

    it.each(['1', ''])(
      'reports available=true with a live client when Redis answers (REQUIRE_TEST_REDIS=%j)',
      async (requirement) => {
        process.env.REQUIRE_TEST_REDIS = requirement
        const stub = await startRedisStub(PONG)
        try {
          const lease = await acquireRedisTestLease(`redis://127.0.0.1:${stub.port}`)
          expect(lease.available).toBe(true)
          await expect(lease.redis?.ping()).resolves.toBe('PONG')
          lease.release()
        } finally {
          await stub.close()
        }
      },
    )

    it('honors ALLOW_REMOTE_TEST_DB=1: a remote host is attempted, not refused', async () => {
      process.env.ALLOW_REMOTE_TEST_DB = '1'
      // Nothing listens there — the guard does not throw; the probe reports
      // unavailability instead (refuses REMOTE only without the opt-out).
      const lease = await acquireRedisTestLease('redis://cache.internal.example.com:6379')
      expect(lease.available).toBe(false)
      lease.release()
    }, 15_000)
  })

  describe('REQUIRE_TEST_REDIS (fail closed where Redis must exist)', () => {
    it('throws, naming the endpoint and the variable, when Redis is required and nothing listens', async () => {
      process.env.REQUIRE_TEST_REDIS = '1'
      const port = await closedLocalPort()

      const outcome = await acquireRedisTestLease(
        `redis://default:hunter2@127.0.0.1:${port}`,
      ).catch((error: unknown) => error)

      expect(outcome).toBeInstanceOf(TestEnvironmentError)
      expect(outcome).toMatchObject({ code: 'redis_required_unreachable' })
      const { message } = outcome as TestEnvironmentError
      expect(message).toContain(`127.0.0.1:${port}`)
      expect(message).toContain('REQUIRE_TEST_REDIS')
      expect(message).toContain('probe timeout')
      expect(message).not.toContain('hunter2')
    }, 15_000)

    it('throws when Redis is required and the probe is answered with an error', async () => {
      process.env.REQUIRE_TEST_REDIS = '1'
      const stub = await startRedisStub(PING_REFUSED)
      try {
        const outcome = await acquireRedisTestLease(
          `redis://127.0.0.1:${stub.port}`,
        ).catch((error: unknown) => error)

        expect(outcome).toBeInstanceOf(TestEnvironmentError)
        expect(outcome).toMatchObject({ code: 'redis_required_unreachable' })
        expect((outcome as TestEnvironmentError).message).toContain('ERR probe refused')
      } finally {
        await stub.close()
      }
    })

    it('keeps the skip for an empty REQUIRE_TEST_REDIS, the shell idiom for unset', async () => {
      process.env.REQUIRE_TEST_REDIS = ''
      const stub = await startRedisStub(PING_REFUSED)
      try {
        const lease = await acquireRedisTestLease(`redis://127.0.0.1:${stub.port}`)
        expect(lease.available).toBe(false)
        expect(lease.redis).toBeUndefined()
      } finally {
        await stub.close()
      }
    })

    it.each(['true', 'yes', '0'])(
      'refuses REQUIRE_TEST_REDIS=%j rather than guess whether Redis is required',
      async (value) => {
        process.env.REQUIRE_TEST_REDIS = value

        const outcome = await acquireRedisTestLease('redis://localhost:6379').catch(
          (error: unknown) => error,
        )

        expect(outcome).toBeInstanceOf(TestEnvironmentError)
        expect(outcome).toMatchObject({ code: 'invalid_redis_requirement' })
        expect((outcome as TestEnvironmentError).message).toContain(
          `REQUIRE_TEST_REDIS is "${value}"`,
        )
      },
    )
  })

  // The arm above only protects CI if the job that runs the Redis-backed suites
  // sets it, and only a job that has a Redis service may set it.
  describe('CI wiring', () => {
    const WORKFLOWS = resolve(import.meta.dirname, '../../../.github/workflows')
    const RUNS_INTEGRATION = /test:integration|--project=integration/u
    const SETS_REQUIREMENT = /^\s+REQUIRE_TEST_REDIS:/mu
    const REQUIRES_REDIS = /^\s+REQUIRE_TEST_REDIS: '1'$/mu
    const REDIS_SERVICE = /^ {4}services:\n(?:.*\n)*? {6}redis:$/mu

    const jobs = readdirSync(WORKFLOWS)
      .filter((file) => file.endsWith('.yml'))
      .flatMap((file) => {
        const text = readFileSync(resolve(WORKFLOWS, file), 'utf8')
        const body = text.slice(text.indexOf('\njobs:\n'))
        return body
          .split(/\n(?= {2}[\w-]+:\n)/u)
          .slice(1)
          .map((block) => ({ id: `${file}#${block.trim().split(':')[0]}`, block }))
      })

    it('requires Redis in every step that runs the integration project, beside a Redis service', () => {
      const integrationJobs = jobs.filter(({ block }) => RUNS_INTEGRATION.test(block))
      // A new job that runs the integration project joins this list only with
      // a Redis service and the requirement on its test step.
      expect(integrationJobs.map(({ id }) => id)).toEqual(['ci.yml#test-integration'])

      for (const { id, block } of integrationJobs) {
        const steps = block
          .split(/\n(?= {6}- )/u)
          .filter((step) => RUNS_INTEGRATION.test(step))
        expect(block, `${id} declares a Redis service`).toMatch(REDIS_SERVICE)
        expect(steps, `${id} has a step that runs the integration project`).not.toEqual(
          [],
        )
        for (const step of steps) {
          expect(step, `${id} sets REQUIRE_TEST_REDIS on the test step`).toMatch(
            REQUIRES_REDIS,
          )
        }
      }
    })

    it('never requires Redis in a job that has no Redis service', () => {
      const withoutRedis = jobs
        .filter(({ block }) => SETS_REQUIREMENT.test(block))
        .filter(({ block }) => !REDIS_SERVICE.test(block))
      expect(withoutRedis.map(({ id }) => id)).toEqual([])
    })
  })
})
