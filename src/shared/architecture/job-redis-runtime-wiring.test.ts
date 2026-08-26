import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const worker = readFileSync(resolve(process.cwd(), 'src/worker/index.ts'), 'utf8')
const localCompose = readFileSync(resolve(process.cwd(), 'compose.local.yml'), 'utf8')

describe('BullMQ Redis boot contract', () => {
  it('asserts the configured runtime before constructing queue clients', () => {
    expect(worker).toContain('assertConfiguredJobRedisRuntime')
    const assertion = worker.indexOf('await assertConfiguredJobRedisRuntime')
    const container = worker.indexOf('createContainer({ enableJobs: true })')
    expect(assertion).toBeGreaterThan(-1)
    expect(container).toBeGreaterThan(assertion)
  })

  it('declares noeviction in the production-shaped local stack', () => {
    expect(localCompose).toMatch(
      /command: \[redis-server, --appendonly, 'yes', --maxmemory-policy, noeviction\]/,
    )
  })
})
