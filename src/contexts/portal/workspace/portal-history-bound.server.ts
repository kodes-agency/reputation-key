import { and, eq, lt, or, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import type { HistoryBound } from '../domain/portal-history'

/**
 * The SQL form of a History bound: rows strictly before the cursor. Ids are
 * compared as text in the "C" collation, the same order the merge uses for keys,
 * so a page boundary never skips or repeats a row that shares an instant.
 * `idText` is omitted for a source that has no row id (its bound never has one).
 */
export function historyBoundCondition(
  at: AnyColumn,
  idText: SQL | null,
  bound: HistoryBound | null | undefined,
): SQL | undefined {
  if (!bound) return undefined
  const before = lt(at, bound.at)
  if (!bound.inclusive) return before
  const idBefore =
    bound.afterId === null || idText === null
      ? undefined
      : sql`${idText} COLLATE "C" < ${bound.afterId} COLLATE "C"`
  return or(before, and(eq(at, bound.at), idBefore))
}

/** ORDER BY expression matching `historyBoundCondition`'s id order. */
export const historyIdOrder = (idText: SQL): SQL => sql`${idText} COLLATE "C"`
