import { existsSync, readFileSync, readdirSync } from 'node:fs'
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

  // ARC-03-T17: docs/standards.md 3.1 used to MANDATE the shape ARC-03 removes.
  // A standard that contradicts the code is worse than no standard: reviewers
  // cite it, and the next build reintroduces the reach-through.
  it('states the capability-group build return shape as the standard', () => {
    const standards = read('docs/standards.md')
    const section = standards.slice(
      standards.indexOf('### 3.1 Return shape'),
      standards.indexOf('## 4. CONTEXT.md Standards'),
    )

    expect(section).toContain('NAMED capability groups')
    expect(section).toContain('publicApi')
    for (const group of ['worker', 'maintenance', 'lifecycle', 'webhook']) {
      expect(section, group).toContain(`${group}?: { ... }`)
    }
    // The retired mandate must be gone, not merely de-emphasised.
    expect(section).not.toContain('internal.repos` \u2014 repositories accessible')
    expect(section).not.toContain('`composition.ts` may access `internal`.')
    expect(section).toContain('no production `.internal` reach-through')
    expect(section).toContain('exposeSimulationRuntime')
  })

  it('publishes the composition and process-boundary note it points at', () => {
    const note = read('docs/architecture/composition-and-process-boundaries.md')

    for (const deployable of ['web', 'worker', 'sidecar']) {
      expect(note, deployable).toContain(`**${deployable}**`)
    }
    expect(note).toContain('cell-us')
    expect(note).toContain('one complete Application Container')
    expect(note).toContain(
      '[COMPOSITION] a complete Application Container already exists in this process',
    )

    // Every executable authority the note links must exist on disk.
    for (const path of [
      'src/composition/deployables.ts',
      'src/shared/testing/process-fixtures/',
      'src/shared/architecture/ambient-runtime-read-authority.ts',
      'scripts/check-architecture-boundary-controls.mjs',
      'src/shared/architecture/named-cross-context-seams.test.ts',
    ]) {
      expect(existsSync(resolve(ROOT, path)), path).toBe(true)
      expect(note, path).toContain(path)
    }
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

  it.each([
    [
      'keeps no security audit report at the repository root',
      () => {
        expect(existsSync(resolve(ROOT, 'SECURITY-AUDIT-REPORT.md'))).toBe(false)
      },
    ],
    [
      'cites only paths that exist from docs/security',
      () => {
        const directory = resolve(ROOT, 'docs/security')
        const documents = readdirSync(directory, { withFileTypes: true }).filter(
          (entry) => entry.isFile() && entry.name.endsWith('.md'),
        )

        for (const document of documents) {
          const contents = read(`docs/security/${document.name}`)
          const citedPaths = [
            ...contents.matchAll(/`((?:src|scripts|services|server)\/[^`]+)`/gu),
          ].map((match) => match[1]!)

          for (const path of citedPaths) {
            expect(
              existsSync(resolve(ROOT, path)),
              `docs/security/${document.name}: ${path}`,
            ).toBe(true)
          }
        }
      },
    ],
  ] as const)('%s', (_name, assertion) => {
    assertion()
  })
})
