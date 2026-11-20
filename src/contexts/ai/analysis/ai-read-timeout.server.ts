// The time budget of an AI dashboard read. A read that outlives it is cancelled by the
// database (`statement_timeout`) and surfaces as `AiInsightsReadTimeout`, so a slow
// Property costs the page its answer, not the pool a connection.
import { sql } from 'drizzle-orm'
import type { Database, Tx } from '#/shared/db'

export const AI_INSIGHTS_READ_BUDGET_MS = 5_000

function isPgStatementTimeout(error: unknown): boolean {
  let current: unknown = error
  for (
    let depth = 0;
    depth < 3 && typeof current === 'object' && current !== null;
    depth += 1
  ) {
    if ('code' in current && current.code === '57014') return true
    current = 'cause' in current ? current.cause : undefined
  }
  return false
}

export async function withStatementTimeout<T>(
  db: Database,
  budgetMs: number,
  read: (transaction: Tx) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`SELECT set_config('statement_timeout', ${String(budgetMs)}, true)`,
      )
      return read(transaction)
    })
  } catch (error) {
    if (isPgStatementTimeout(error)) {
      throw {
        _tag: 'AiInsightsReadTimeout',
        budgetMs,
        message: `AI insights read exceeded ${budgetMs}ms budget`,
      }
    }
    throw error
  }
}
