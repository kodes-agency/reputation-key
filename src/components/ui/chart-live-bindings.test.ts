import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/components/ui/chart.tsx'), 'utf8')

/**
 * Recharts and the application chart helpers can land on opposite sides of a
 * production chunk cycle. Copying a Recharts component into a module-scoped
 * const freezes `undefined` when that side evaluates first; an aliased ESM
 * binding stays live until React reads it after both chunks initialize.
 */
describe('chart component live bindings', () => {
  it('does not snapshot Recharts components during module evaluation', () => {
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
