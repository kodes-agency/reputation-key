import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

describe('current design authority', () => {
  it('retains the project design contract and no stale ReUI vendor catalogue', () => {
    const design = join(ROOT, 'DESIGN.md')
    const staleVendorCatalogue = join(ROOT, 'REUI.md')

    expect(existsSync(design)).toBe(true)
    expect(readFileSync(design, 'utf8')).toContain('# Design System: Reputation Key')
    expect(existsSync(staleVendorCatalogue)).toBe(false)
  })

  // ARC-03-T17: an authority document that contradicts the code is a live
  // hazard — a reviewer cites it and the next build reintroduces the shape the
  // program removed. This matcher must reject the retired claim wherever it
  // appears, not just in the section that happens to hold it today.
  describe('the build return-shape standard tracks the code', () => {
    const STALE_CLAIMS = [
      '`composition.ts` may access `internal`.',
      'internal.repos` — repositories accessible',
      'internal.useCases` — use cases accessible',
    ] as const

    const containsStaleClaim = (text: string): boolean =>
      STALE_CLAIMS.some((claim) => text.includes(claim))

    it('rejects a fixture asserting the retired internal.repos standard', () => {
      expect(
        containsStaleClaim(
          '- `internal.repos` — repositories accessible to cross-context adapters.',
        ),
      ).toBe(true)
      expect(containsStaleClaim('- `publicApi` — the ONLY cross-context boundary.')).toBe(
        false,
      )
    })

    it('carries no stale claim in docs/standards.md', () => {
      const standards = readFileSync(join(ROOT, 'docs/standards.md'), 'utf8')

      expect(containsStaleClaim(standards)).toBe(false)
      expect(standards).toContain('NAMED capability groups')
      expect(standards).toContain(
        'docs/architecture/composition-and-process-boundaries.md',
      )
    })

    it('publishes the composition and process-boundary note alongside it', () => {
      expect(
        existsSync(join(ROOT, 'docs/architecture/composition-and-process-boundaries.md')),
      ).toBe(true)
    })
  })

  it('keeps story-only data out of production-shaped module names', () => {
    const storyOnlyModules = [
      {
        retired: 'src/components/features/notification/notification-fixtures.ts',
        current: 'src/components/features/notification/notification.stories.fixtures.ts',
      },
      {
        retired: 'src/components/features/dashboard/fleet-overview-stories-data.ts',
        current: 'src/components/features/dashboard/fleet-overview.stories.fixtures.ts',
      },
    ] as const

    expect(
      storyOnlyModules.map(({ retired, current }) => ({
        retired: existsSync(join(ROOT, retired)),
        current: existsSync(join(ROOT, current)),
      })),
    ).toEqual(storyOnlyModules.map(() => ({ retired: false, current: true })))
  })
})
