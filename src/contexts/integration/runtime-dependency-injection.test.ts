import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string): string =>
  readFileSync(join(process.cwd(), 'src/contexts/integration', file), 'utf8')

describe('Integration runtime dependency injection', () => {
  it('keeps Integration build identifiers and lock ownership composition-owned', () => {
    const source = read('build.ts')
    expect(source).not.toMatch(/\b(?:randomUUID|randomBytes)\b/u)
    expect(source).toContain('idGen: () => string')
    expect(source).toContain('invalidationOwnerGen: () => string')
  })

  it('requires an injected OAuth clock', () => {
    const source = read('infrastructure/adapters/google-oauth.adapter.ts')
    expect(source).toContain('clock: () => Date')
    expect(source).not.toMatch(/clock\?:/u)
    expect(source).not.toMatch(/config\.clock\s*\?\?/u)
    expect(source).not.toMatch(/new Date\s*\(\s*\)/u)
  })

  it('keeps the import claim-reaper logger worker-owned', () => {
    const source = read('infrastructure/jobs/google-import-claim-reaper.job.ts')
    expect(source).not.toMatch(/\bgetLogger\s*\(/u)
    expect(source).toContain('logger: LoggerPort')
  })
})
