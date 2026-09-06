import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { METRIC_READING_DIRECT_READ_AUTHORITIES } from './metric-read-authority'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const PRODUCTION_ROOTS = [SRC, join(ROOT, 'scripts')] as const

function productionTypeScriptFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionTypeScriptFiles(path)
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return []
    if (
      entry.name.includes('.test.') ||
      entry.name.includes('.stories.') ||
      entry.name.includes('.integration.')
    ) {
      return []
    }
    return [path]
  })
}

function isDirectMetricReadingRead(rawSource: string): boolean {
  const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const schemaImport = source.match(
    /import\s*\{([\s\S]*?)\}\s*from\s*['"]#\/shared\/db\/schema(?:\/metric\.schema)?['"]/,
  )?.[1]
  const importedAlias = schemaImport?.match(
    /\bmetricReadings\b(?:\s+as\s+([A-Za-z_$][\w$]*))?/,
  )?.[1]
  const drizzleName =
    importedAlias ?? (schemaImport?.includes('metricReadings') ? 'metricReadings' : null)
  const escapedDrizzleName = drizzleName?.replaceAll('$', '\\$') ?? null
  const readsImportedTable =
    escapedDrizzleName !== null &&
    new RegExp(
      `\\.(?:from|innerJoin|leftJoin|rightJoin|fullJoin)\\(\\s*${escapedDrizzleName}\\s*(?:,|\\))`,
    ).test(source)
  const readsRelationalTable =
    escapedDrizzleName !== null &&
    new RegExp(
      `\\.query\\s*\\.\\s*${escapedDrizzleName}\\s*\\.\\s*(?:findFirst|findMany)\\s*\\(`,
    ).test(source)
  const readsInterpolatedTable =
    escapedDrizzleName !== null &&
    new RegExp(`\\b(?:FROM|JOIN)\\s+\\$\\{${escapedDrizzleName}\\}`, 'i').test(source)
  const readsRawTable =
    /\b(?:FROM|JOIN)\s+(?:(?:"?public"?)\.)?"?metric_readings"?(?=\s|$)/i.test(source)
  return (
    readsImportedTable || readsRelationalTable || readsInterpolatedTable || readsRawTable
  )
}

function discoveredDirectMetricReadingFiles(): readonly string[] {
  return PRODUCTION_ROOTS.flatMap(productionTypeScriptFiles)
    .filter((path) => !path.startsWith(join(SRC, 'contexts', 'metric')))
    .filter((path) => !path.startsWith(join(SRC, 'shared', 'db', 'schema')))
    .filter((path) => isDirectMetricReadingRead(readFileSync(path, 'utf8')))
    .map((path) => relative(ROOT, path))
    .sort()
}

describe('Metric reading authority inventory', () => {
  it('discovers Drizzle aliases and raw quoted SQL without mistaking writes or comments for reads', () => {
    expect(
      isDirectMetricReadingRead(`
        import { metricReadings as readings } from '#/shared/db/schema/metric.schema'
        db.select().from(readings)
      `),
    ).toBe(true)
    expect(isDirectMetricReadingRead('SELECT * FROM "public"."metric_readings"')).toBe(
      true,
    )
    expect(
      isDirectMetricReadingRead(
        'SELECT 1 FROM metric_corrections JOIN metric_readings ON true',
      ),
    ).toBe(true)
    expect(
      isDirectMetricReadingRead(`
        import { metricReadings as readings } from '#/shared/db/schema'
        db.select().from(otherTable).leftJoin(readings, sql\`true\`)
      `),
    ).toBe(true)
    expect(
      isDirectMetricReadingRead(`
        import { metricReadings } from '#/shared/db/schema'
        db.query.metricReadings.findMany()
      `),
    ).toBe(true)
    expect(
      isDirectMetricReadingRead(`
        import { metricReadings } from '#/shared/db/schema'
        db.insert(metricReadings)
        // Reads from metric_readings are forbidden here.
      `),
    ).toBe(false)
  })

  it('allows only the two named Dashboard readers', () => {
    expect(METRIC_READING_DIRECT_READ_AUTHORITIES).toEqual([
      {
        id: 'dashboard.legacy-kpi-projection',
        source: 'src/contexts/dashboard/infrastructure/read-facade.ts',
        symbol: 'readMetricAggregates',
      },
      {
        id: 'dashboard.fleet-overview-projection',
        source:
          'src/contexts/dashboard/infrastructure/adapters/fleet-overview-projection.adapter.ts',
        symbol: 'createFleetOverviewProjectionAdapter.read',
      },
    ])
    expect(
      METRIC_READING_DIRECT_READ_AUTHORITIES.map(({ source }) => source).sort(),
    ).toEqual(discoveredDirectMetricReadingFiles())
  })
})
