import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string): string =>
  readFileSync(join(process.cwd(), 'src/contexts/notification', file), 'utf8')

describe('Notification runtime dependency injection', () => {
  it('keeps context identifiers composition-owned', () => {
    const build = read('build.ts')
    expect(build).not.toMatch(/\b(?:crypto\.)?randomUUID\s*\(/u)
    expect(build).toContain('idGen: () => string')

    const digest = read('infrastructure/jobs/digest-notification.job.ts')
    expect(digest).not.toMatch(/\brandomUUID\b/u)
    expect(digest).toContain('batchIdGen: () => string')
  })

  it('keeps the public unsubscribe handler independent from ambient roots', () => {
    const server = read('server/one-click-unsubscribe.ts')
    expect(server).not.toMatch(/\bget(?:Container|Env|Logger)\s*\(/u)
    expect(server).toContain('createOneClickUnsubscribePostHandler')
  })
})
