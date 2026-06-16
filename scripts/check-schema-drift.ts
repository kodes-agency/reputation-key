// One-off schema drift checker — compares Drizzle schema objects against DB.
import * as schema from '../src/shared/db/schema/business'
import { Pool } from 'pg'

type Cols = Record<string, string[]>

function getSchemaColumns(): Cols {
  const result: Cols = {}
  for (const [, table] of Object.entries(schema)) {
    const symbols = Object.getOwnPropertySymbols(table)
    const nameSym = symbols.find((s) => s.toString().includes('drizzle:Name'))
    if (!nameSym) continue
    const tName = (table as Record<symbol, unknown>)[nameSym]
    if (typeof tName !== 'string') continue
    const cols: string[] = []
    for (const [, col] of Object.entries(table as Record<string, unknown>)) {
      if (col && typeof col === 'object' && 'name' in col) {
        const name = (col as { name: unknown }).name
        if (typeof name === 'string') cols.push(name)
      }
    }
    if (cols.length > 0) result[tName] = cols.sort()
  }
  return result
}

async function main(): Promise<void> {
  const schemaCols = getSchemaColumns()

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const res = await pool.query(`
    SELECT table_name, array_agg(column_name ORDER BY column_name) as columns
    FROM information_schema.columns WHERE table_schema = 'public'
    GROUP BY table_name
  `)
  await pool.end()

  const dbCols: Cols = {}
  for (const row of res.rows as Array<{ table_name: string; columns: string[] }>) {
    dbCols[row.table_name] = row.columns
  }

  let found = false
  for (const [table, cols] of Object.entries(schemaCols).sort()) {
    const db = dbCols[table] || []
    const missing = cols.filter((c) => !db.includes(c))
    if (missing.length > 0) {
      console.log(`MISSING in ${table}: ${missing.join(', ')}`)
      found = true
    }
  }
  if (!found) console.log('No drift detected')
}

main().catch(console.error)
