import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../../..')
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8')

const CURRENT_PROGRAM = 'docs/comprehensive-beta-implementation-program-2026-08-25.md'

describe('documentation execution authority', () => {
  it('names one approved current implementation program', () => {
    const program = read(CURRENT_PROGRAM)

    expect(program).toMatch(/Status:\*\* Active execution authority/u)
    expect(program).toMatch(/implementation approved 2026-08-25/u)
    expect(program).toContain('## 3. Fixed product and architecture contract')
  })

  it.each([
    ['docs/remaining-work.md', /Historical snapshot \u2014 superseded 2026-08-25/u],
    ['docs/product-readiness-program-2026-07/README.md', /Historical program index/u],
    ['docs/design/ui-ux-overhaul-proposal-2026-08-19.md', /Superseded proposal/u],
  ] as const)(
    'keeps the stale execution surface %s visibly superseded',
    (path, marker) => {
      const document = read(path)

      expect(document).toMatch(marker)
      expect(document).toContain(
        'comprehensive-beta-implementation-program-2026-08-25.md',
      )
    },
  )
})
