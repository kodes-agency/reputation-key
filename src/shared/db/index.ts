// Drizzle database connection — uses node-postgres (pg) driver
// Uses the shared pool from pool.ts to avoid duplicating connections.
import { drizzle } from 'drizzle-orm/node-postgres'
import { performance } from 'node:perf_hooks'
import { sql, type SQL } from 'drizzle-orm'
import type { Pool } from 'pg'
import { getPool } from './pool'
import { getExecutionDeadline } from './execution-deadline.server'
import { currentScope, type DatabaseScope } from './scope-store.server'
import { recordScopeSetting } from './scope-observation.server'

let _db: ReturnType<typeof drizzle> | undefined

// Every setting is LOCAL: it resets on commit or rollback, so a pooled
// client never carries one transaction's deadline or tenant into the next.
function transactionSettings(
  deadline: ReturnType<typeof getExecutionDeadline>,
  scope: DatabaseScope | undefined,
): SQL[] {
  const settings: SQL[] = []
  if (deadline) {
    // Never pass zero: PostgreSQL interprets it as an unlimited statement.
    const remainingMs = Math.max(1, deadline.expiresAt - Date.now())
    settings.push(sql`set_config('statement_timeout', ${String(remainingMs)}, true)`)
  }
  if (scope) {
    const organizationId = scope.kind === 'tenant' ? scope.organizationId : ''
    settings.push(
      sql`set_config('app.scope', ${scope.kind}, true)`,
      sql`set_config('app.organization_id', ${organizationId}, true)`,
    )
  }
  return settings
}

/**
 * Build a database whose transactions inherit the dispatch deadline and the
 * current database scope.
 */
export function createDatabase(pool: Pool): ReturnType<typeof drizzle> {
  const db = drizzle(pool)
  const transaction = db.transaction.bind(db)
  db.transaction = async (work, config) => {
    const deadline = getExecutionDeadline()
    deadline?.signal.throwIfAborted()
    const scope = currentScope()
    return transaction(async (tx) => {
      deadline?.signal.throwIfAborted()
      const settings = transactionSettings(deadline, scope)
      if (settings.length > 0) {
        const started = performance.now()
        await tx.execute(sql`select ${sql.join(settings, sql`, `)}`)
        if (scope) recordScopeSetting(performance.now() - started)
        deadline?.signal.throwIfAborted()
      }
      const result = await work(tx)
      deadline?.signal.throwIfAborted()
      return result
    }, config)
  }
  return db
}

export function getDb() {
  _db ??= createDatabase(getPool())
  return _db
}

export type Database = ReturnType<typeof getDb>

// Re-exported so db-layer and repository code can type a callback that
// must run either at the top level or inside a transaction without reaching
// into the outbox module, which owns the canonical definition because every
// outbox-commit helper already needs it.
export type { Tx } from '#/shared/outbox/commit'
