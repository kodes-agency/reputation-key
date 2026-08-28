import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

describe('Integration infrastructure time authority', () => {
  it('does not read ambient mutation or polling time in retained stores', () => {
    for (const path of [
      'src/contexts/integration/infrastructure/google-import-v2-store.ts',
      'src/contexts/integration/infrastructure/integration-command-store.ts',
      'src/contexts/integration/infrastructure/repositories/google-connection.repository.ts',
      'src/contexts/integration/infrastructure/organization-google-credential-home-backfill.store.ts',
    ]) {
      const source = read(path)
      expect(source, path).not.toMatch(/\bDate\.now\s*\(/u)
      expect(source, path).not.toMatch(/\bnew Date\s*\(\s*\)/u)
    }
  })

  it('threads the context clock into every affected store factory', () => {
    const build = read('src/contexts/integration/build.ts')

    expect(build).toMatch(
      /createGoogleConnectionRepository\(\s*deps\.db,\s*propertyFkCleanup,\s*deps\.clock,?\s*\)/u,
    )
    expect(build).toMatch(
      /createAtomicIntegrationCommandStore\(\s*deps\.db,\s*deps\.events,\s*deps\.clock,?\s*\)/u,
    )
    expect(build).toContain('createGoogleImportV2Store(deps.db, deps.clock)')
  })
})
