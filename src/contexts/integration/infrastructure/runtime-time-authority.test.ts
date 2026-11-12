import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

describe('Integration infrastructure time authority', () => {
  it('does not read ambient mutation or polling time in retained stores', () => {
    for (const path of [
      'src/contexts/integration/imports/import-store.server.ts',
      'src/contexts/integration/imports/import-claims.server.ts',
      'src/contexts/integration/imports/import-completion.server.ts',
      'src/contexts/integration/imports/import-dispatch-store.server.ts',
      'src/contexts/integration/imports/import-lifecycle-store.server.ts',
      'src/contexts/integration/imports/import-progress-store.server.ts',
      'src/contexts/integration/imports/import-retention.server.ts',
      'src/contexts/integration/imports/import-retry.server.ts',
      'src/contexts/integration/infrastructure/integration-command-store.ts',
      'src/contexts/integration/infrastructure/repositories/google-connection.repository.ts',
    ]) {
      const source = read(path)
      expect(source, path).not.toMatch(/\bDate\.now\s*\(/u)
      expect(source, path).not.toMatch(/\bnew Date\s*\(\s*\)/u)
    }
  })

  it('threads the context clock into every affected store factory', () => {
    const build = read('src/contexts/integration/build.ts')
    const connections = read(
      'src/contexts/integration/connections/connections-runtime.server.ts',
    )

    expect(connections).toMatch(
      /createGoogleConnectionRepository\(\s*deps\.db,\s*deps\.clock,?\s*\)/u,
    )
    expect(connections).toMatch(
      /createAtomicIntegrationCommandStore\(\s*deps\.db,\s*deps\.clock,?\s*\)/u,
    )
    expect(build).toMatch(/createImportStore\(\s*deps\.db,\s*deps\.clock,/u)
  })
})
