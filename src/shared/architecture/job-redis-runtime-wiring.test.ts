import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const worker = readFileSync(resolve(process.cwd(), 'src/worker/index.ts'), 'utf8')
const localCompose = readFileSync(resolve(process.cwd(), 'compose.local.yml'), 'utf8')
const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')
const webGuard = readFileSync(
  resolve(process.cwd(), 'server/plugins/redis-runtime-guard.ts'),
  'utf8',
)

describe('BullMQ Redis boot contract', () => {
  it('asserts the configured runtime before constructing queue clients', () => {
    expect(worker).toContain('assertConfiguredJobRedisRuntime')
    const assertion = worker.indexOf('await assertConfiguredJobRedisRuntime')
    // ARC-03-T15: the worker builds the WORKER deployable's container.
    const container = worker.indexOf('createWorkerContainer()')
    expect(assertion).toBeGreaterThan(-1)
    expect(container).toBeGreaterThan(assertion)
  })

  it('declares noeviction in the production-shaped local stack', () => {
    const queueRedis = localCompose.match(
      /\n {2}queue-redis:[\s\S]*?\n {2}provider-redis:/,
    )?.[0]
    expect(queueRedis).toBeDefined()
    expect(queueRedis).toMatch(
      /command: \[redis-server, --appendonly, 'yes', --maxmemory-policy, noeviction\]/,
    )
  })

  it('owns signals and fatal asynchronous process failures explicitly', () => {
    expect(worker).toContain('createWorkerProcessFailurePolicy')
    expect(worker).toContain("process.once('SIGTERM'")
    expect(worker).toContain("process.once('SIGINT'")
    expect(worker).toContain("process.once('unhandledRejection'")
    expect(worker).toContain("process.once('uncaughtException'")
  })

  it('registers the same Redis topology/runtime guard for the web producer', () => {
    expect(viteConfig).toContain("'server/plugins/redis-runtime-guard.ts'")
    expect(webGuard).toContain('assertProductionRedisTopology(env)')
    expect(webGuard).toContain('await assertConfiguredJobRedisRuntime(redisUrl)')
  })
})
