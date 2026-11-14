// Lets a Drizzle database or transaction run the shared seed statements, which
// are written with `$1`-style placeholders for a pg Pool.

import { sql, type Param, type SQL } from 'drizzle-orm'

type SeedQueryRunner = Readonly<{
  query: (text: string, values: unknown[]) => Promise<{ rows: unknown[] }>
}>

type DrizzleExecutor = Readonly<{
  execute: (query: SQL) => Promise<{ rows: unknown[] }>
}>

const PLACEHOLDER = /\$(\d+)/g

export function drizzleSeedRunner(db: DrizzleExecutor): SeedQueryRunner {
  return {
    query: async (text, values) => {
      const chunks: (SQL | Param)[] = []
      let from = 0
      for (const match of text.matchAll(PLACEHOLDER)) {
        chunks.push(sql.raw(text.slice(from, match.index)))
        chunks.push(sql.param(values[Number(match[1]) - 1]))
        from = match.index + match[0].length
      }
      chunks.push(sql.raw(text.slice(from)))
      return db.execute(sql.join(chunks, sql.raw('')))
    },
  }
}
