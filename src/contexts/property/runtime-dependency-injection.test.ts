import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Property runtime dependency injection', () => {
  it('keeps reconciliation report time caller-owned', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/contexts/property/infrastructure/repositories/reconcile-regions.repository.ts',
      ),
      'utf8',
    )
    expect(source).not.toMatch(/\bnew Date\s*\(\s*\)/u)
    expect(source).toMatch(
      /buildRegionReconcileReport\(\s*db:\s*Database,\s*clock:\s*Clock/u,
    )
  })
})
