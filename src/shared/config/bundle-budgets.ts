// BETA-2 B2.7: Bundle size budget configuration.
//
// Defines maximum allowed sizes for route chunks. The build reports
// actual sizes; regressions beyond these thresholds should be reviewed.
//
// These are advisory budgets — the build doesn't hard-fail on them yet.
// In CI, the sizes are logged for trend monitoring.

/**
 * Bundle size budgets in kilobytes (gzipped).
 * Based on initial baseline measurement + 20% headroom.
 */
export const BUNDLE_BUDGETS = {
  // Core vendor chunks
  vendorCharts: 150, // recharts
  vendorDnd: 80, // @dnd-kit

  // Route chunks (measured from production build)
  root: 200, // root layout + shared components
  inbox: 100, // inbox triage page
  dashboard: 120, // dashboard with charts
  properties: 80, // property detail pages
  goals: 90, // goal pages
  settings: 60, // settings pages

  // Total initial JS (before lazy chunks)
  initialTotal: 350,
} as const

/**
 * Format bytes as a human-readable KB string.
 */
export function formatKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`
}

/**
 * Check if a chunk size is within budget.
 */
export function isWithinBudget(
  chunkName: keyof typeof BUNDLE_BUDGETS,
  sizeBytes: number,
): boolean {
  const budgetBytes = BUNDLE_BUDGETS[chunkName] * 1024
  return sizeBytes <= budgetBytes
}

/**
 * Build a budget report from actual chunk sizes.
 */
export type ChunkMeasurement = Readonly<{
  name: string
  sizeBytes: number
  gzippedBytes: number
}>

export type BudgetReport = Readonly<{
  chunks: readonly (ChunkMeasurement & {
    budgetKB?: number
    withinBudget: boolean
  })[]
  totalGzipped: number
  regressions: number
}>

export function buildBudgetReport(chunks: readonly ChunkMeasurement[]): BudgetReport {
  const mapped = chunks.map((chunk) => {
    const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, '')
    const budgetKey = Object.keys(BUNDLE_BUDGETS).find((key) =>
      normalize(chunk.name).includes(normalize(key)),
    ) as keyof typeof BUNDLE_BUDGETS | undefined

    const budgetKB = budgetKey ? BUNDLE_BUDGETS[budgetKey] : undefined
    const withinBudget = budgetKB ? chunk.gzippedBytes <= budgetKB * 1024 : true

    return { ...chunk, budgetKB, withinBudget }
  })

  return {
    chunks: mapped,
    totalGzipped: chunks.reduce((sum, c) => sum + c.gzippedBytes, 0),
    regressions: mapped.filter((c) => !c.withinBudget).length,
  }
}
