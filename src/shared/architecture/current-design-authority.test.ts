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
