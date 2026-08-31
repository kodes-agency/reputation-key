import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateFindingRevalidationFragment } from './finding-revalidation-fragment'

describe('repository data-boundary and runtime-safeguard finding fragment', () => {
  it('validates all 18 SEC rows against immutable repository evidence', () => {
    const root = process.cwd()
    const fragment = JSON.parse(
      readFileSync(
        join(
          root,
          'docs/release-evidence/review/finding-revalidation-fragments/data-runtime-safeguards-2026-08-26.json',
        ),
        'utf8',
      ),
    ) as unknown
    const register = readFileSync(
      join(
        root,
        'docs/release-evidence/review/718fad1807b7422885584660bd3580f2a3a49113/local-darwin-arm64-node22.23.2/finding-register.json',
      ),
      'utf8',
    )
    const plan = readFileSync(
      join(root, 'docs/comprehensive-beta-implementation-program-2026-08-25.md'),
      'utf8',
    )

    expect(validateFindingRevalidationFragment(fragment, register, plan)).toHaveLength(18)
  })
})
