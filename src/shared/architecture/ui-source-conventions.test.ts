// UI source scans that no lint rule carries and no rendered test can see: each
// guards a defect that reached users or a phone tap target. Rendered behaviour
// stays with each component's own test.

import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walk } from '#/shared/testing/source-tree'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

type Source = Readonly<{ path: string; text: string }>

const TESTS_AND_STORIES = /\.(?:test|stories)\.tsx?$/u

/** Sources beneath `dirs` (from the repository root) with these extensions, less `skip`. */
function sources(
  dirs: readonly string[],
  extensions: RegExp,
  skip: RegExp | null = TESTS_AND_STORIES,
): readonly Source[] {
  return dirs
    .flatMap((dir) => walk(join(ROOT, dir)))
    .filter((file) => extensions.test(file) && !(skip?.test(file) ?? false))
    .map((file) => ({
      path: relative(ROOT, file).split(sep).join('/'),
      text: readFileSync(file, 'utf8'),
    }))
}

// ManagerSidebar and SettingsSidebar share the shell's single open state, so both
// collapse to the icon rail. When Settings used `offcanvas`, collapsing the app
// sidebar and then opening Settings slid its navigation off-screen with no rail
// to bring it back, 'Back to app' included.
describe('the app sidebars', () => {
  it('none opts out of the icon rail', () => {
    const offenders = sources(['src'], /\.tsx$/u, null)
      .filter(({ path }) => path !== 'src/components/ui/sidebar.tsx')
      .filter(({ text }) => /collapsible=["{'`]+offcanvas/u.test(text))
      .map(({ path }) => path)

    expect(offenders).toEqual([])
  })
})

// Below md a control is 44 px tall; under `data-density="compact"` it is 36 px.
// The Inbox is worked on a phone, so none of its screens or dialogs is compact.
describe('the Inbox on a phone', () => {
  it('keeps the 44px tap target: no screen or dialog drops to the compact density', () => {
    const compact = sources(
      ['src/components/inbox', 'src/contexts/reputation/inbox/ui'],
      /\.tsx$/u,
      /\.stories\.tsx$/u,
    )
      .filter(({ text }) => /density=["']compact["']/u.test(text))
      .map(({ path }) => path)

    expect(compact).toEqual([])
  })
})

// Recharts and the application chart helpers can land on opposite sides of a
// production chunk cycle. Copying a Recharts component into a module-scoped
// const freezes `undefined` when that side evaluates first; an aliased ESM
// binding stays live until React reads it after both chunks initialize.
describe('chart component live bindings', () => {
  it('does not snapshot Recharts components during module evaluation', () => {
    const source = readFileSync(join(SRC, 'components/ui/chart.tsx'), 'utf8')
    const eagerCaptures = [
      ...source.matchAll(
        /\bconst\s+(Chart(?:Tooltip|Legend))\s*=\s*RechartsPrimitive\.[A-Za-z]+/gu,
      ),
    ].map((match) => match[1])

    expect(eagerCaptures).toEqual([])
    expect(source).toMatch(/\bLegend\s+as\s+ChartLegend\b/u)
    expect(source).toMatch(/\bTooltip\s+as\s+ChartTooltip\b/u)
  })
})
