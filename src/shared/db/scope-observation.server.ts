// Observe mode for row security: nothing is refused. Each statement that
// touches a table with an `organization_id` column is checked against the
// scope it runs under, and what a policy keyed on that column would refuse is
// counted and logged by reason, entry point and table. Requests also record
// their statement and transaction timing, which prices running every read in
// a short scoped transaction before any policy is enabled.

import { AsyncResource } from 'node:async_hooks'
import { performance } from 'node:perf_hooks'
import { getTableColumns, getTableName, isTable, type Table } from 'drizzle-orm'
import type { ClientBase, Pool } from 'pg'
import { getLogger } from '#/shared/observability/logger'
import {
  getRequestContext,
  getSpanAttrs,
  type RequestContext,
} from '#/shared/observability/request-context'
import * as schema from './schema'
import { currentScope } from './scope-store.server'

export type WouldRefuseReason = 'missing_scope' | 'other_organization'

export type WouldRefuse = Readonly<{
  reason: WouldRefuseReason
  entry: string
  table: string
  statements: number
}>

export type RequestDatabaseTiming = {
  statements: number
  statementMs: number
  autocommitStatements: number
  transactions: number
  transactionMs: number
  scopeSettingMs: number
}

type StatementShape = Readonly<{
  boundary: 'begin' | 'end' | undefined
  tables: readonly string[]
  organizationParams: readonly number[]
}>

type ClientState = { transactionStartedAt: number | undefined }

const FLUSH_INTERVAL_MS = 60_000
const SHAPE_CACHE_LIMIT = 2_000
const TABLE_REFERENCE = /\b(?:from|join|into|update)\s+([^\s,;()]+)/giu
const ORGANIZATION_PARAMETER = /"?organization_id"?\s*=\s*\$(\d+)/giu
const BEGIN = /^\s*(?:begin|start\s+transaction)\b/iu
const END = /^\s*(?:commit|end|rollback)\s*;?\s*$/iu

let tenantTables: ReadonlySet<string> | undefined
const shapes = new Map<string, StatementShape>()
const counts = new Map<string, WouldRefuse>()
const clients = new WeakMap<ClientBase, ClientState>()
const timings = new WeakMap<RequestContext, RequestDatabaseTiming>()
let flushTimer: ReturnType<typeof setInterval> | undefined
let observerFailed = false

/** Tables a row-security policy on `organization_id` would cover. */
export function tenantTableNames(): ReadonlySet<string> {
  if (tenantTables) return tenantTables
  const names = new Set<string>()
  for (const value of Object.values(schema)) {
    if (!isTable(value)) continue
    const table = value as Table
    const columns = Object.values(getTableColumns(table))
    if (columns.some((column) => column.name === 'organization_id')) {
      names.add(getTableName(table))
    }
  }
  tenantTables = names
  return tenantTables
}

export function statementShape(text: string): StatementShape {
  const cached = shapes.get(text)
  if (cached) return cached
  const tenant = tenantTableNames()
  const tables = new Set<string>()
  for (const match of text.matchAll(TABLE_REFERENCE)) {
    // `"public"."reviews"` and `reviews` name the same table.
    const table = match[1]!.replaceAll('"', '').split('.').pop()!.toLowerCase()
    if (tenant.has(table)) tables.add(table)
  }
  const organizationParams = [...text.matchAll(ORGANIZATION_PARAMETER)].map(
    (match) => Number(match[1]) - 1,
  )
  const shape: StatementShape = {
    boundary: BEGIN.test(text) ? 'begin' : END.test(text) ? 'end' : undefined,
    tables: [...tables],
    organizationParams,
  }
  if (shapes.size >= SHAPE_CACHE_LIMIT) shapes.clear()
  shapes.set(text, shape)
  return shape
}

function wouldRefuse(
  shape: StatementShape,
  values: readonly unknown[] | undefined,
): WouldRefuseReason | undefined {
  if (shape.tables.length === 0) return undefined
  const scope = currentScope()
  if (!scope) return 'missing_scope'
  if (scope.kind === 'system') return undefined
  const foreign = shape.organizationParams.some((index) => {
    const value = values?.[index]
    return typeof value === 'string' && value !== scope.organizationId
  })
  return foreign ? 'other_organization' : undefined
}

function count(reason: WouldRefuseReason, tables: readonly string[]): void {
  const entry = currentScope()?.name ?? getSpanAttrs().useCase ?? 'unattributed'
  for (const table of tables) {
    const key = `${reason}\u0000${entry}\u0000${table}`
    const seen = counts.get(key)
    counts.set(key, {
      reason,
      entry,
      table,
      statements: (seen?.statements ?? 0) + 1,
    })
  }
  flushTimer ??= setInterval(flushScopeObservations, FLUSH_INTERVAL_MS)
  flushTimer.unref?.()
}

function requestTiming(): RequestDatabaseTiming | undefined {
  const request = getRequestContext()
  if (!request) return undefined
  let timing = timings.get(request)
  if (!timing) {
    timing = {
      statements: 0,
      statementMs: 0,
      autocommitStatements: 0,
      transactions: 0,
      transactionMs: 0,
      scopeSettingMs: 0,
    }
    timings.set(request, timing)
  }
  return timing
}

/** Database timing of the current request, when it ran any statement. */
export function getRequestDatabaseTiming(): Readonly<RequestDatabaseTiming> | undefined {
  const request = getRequestContext()
  return request ? timings.get(request) : undefined
}

/** Time spent setting the scope at the start of a transaction. */
export function recordScopeSetting(ms: number): void {
  const timing = requestTiming()
  if (timing) timing.scopeSettingMs += ms
}

/** Log and clear the would-refuse counts gathered since the last flush. */
export function flushScopeObservations(): readonly WouldRefuse[] {
  const observed = [...counts.values()]
  counts.clear()
  const logger = getLogger()
  for (const row of observed) {
    logger.warn(
      { ...row, windowMs: FLUSH_INTERVAL_MS },
      'database scope observe: row security would refuse',
    )
  }
  return observed
}

function observeStatement(
  client: ClientBase,
  text: string,
  values: readonly unknown[] | undefined,
): () => void {
  const shape = statementShape(text)
  const state = clients.get(client) ?? { transactionStartedAt: undefined }
  clients.set(client, state)
  const timing = requestTiming()
  const started = performance.now()
  if (shape.boundary === 'begin') state.transactionStartedAt = started
  const inTransaction = state.transactionStartedAt !== undefined
  const reason = wouldRefuse(shape, values)
  if (reason) count(reason, shape.tables)
  return () => {
    const finished = performance.now()
    if (shape.boundary === 'end' && state.transactionStartedAt !== undefined) {
      if (timing) {
        timing.transactions += 1
        timing.transactionMs += finished - state.transactionStartedAt
      }
      state.transactionStartedAt = undefined
    }
    if (!timing || shape.boundary) return
    timing.statements += 1
    timing.statementMs += finished - started
    if (!inTransaction) timing.autocommitStatements += 1
  }
}

function statementOf(args: readonly unknown[]): {
  text: string | undefined
  values: readonly unknown[] | undefined
} {
  const [first, second] = args
  if (typeof first === 'string') {
    return { text: first, values: Array.isArray(second) ? second : undefined }
  }
  if (first && typeof first === 'object' && 'text' in first) {
    const config = first as { text?: unknown; values?: unknown }
    if (typeof config.text === 'string') {
      return {
        text: config.text,
        values: Array.isArray(config.values)
          ? config.values
          : Array.isArray(second)
            ? second
            : undefined,
      }
    }
  }
  return { text: undefined, values: undefined }
}

function reportObserverFailure(error: unknown): void {
  // Observation must never change a statement's outcome; report it once.
  if (observerFailed) return
  observerFailed = true
  getLogger().error({ err: error }, 'database scope observe failed')
}

function safely(observe: () => () => void): () => void {
  let done: () => void
  try {
    done = observe()
  } catch (error) {
    reportObserverFailure(error)
    return () => undefined
  }
  return () => {
    try {
      done()
    } catch (error) {
      reportObserverFailure(error)
    }
  }
}

/**
 * Observe every statement a physical client sends. The original query runs
 * with the same arguments and its result, promise or callback is unchanged.
 */
export function observeClient(client: ClientBase): void {
  const query = client.query.bind(client) as (...args: unknown[]) => unknown
  client.query = ((...args: unknown[]) => {
    const { text, values } = statementOf(args)
    if (text === undefined) return query(...args)
    const done = safely(() => observeStatement(client, text, values))
    const last = args.length - 1
    const callback = args[last]
    if (typeof callback === 'function') {
      const observed = [...args]
      observed[last] = (...results: unknown[]) => {
        done()
        return (callback as (...results: unknown[]) => unknown)(...results)
      }
      return query(...observed)
    }
    const result = query(...args)
    if (result instanceof Promise) {
      result.then(done, done)
    }
    return result
  }) as typeof client.query
}

/**
 * pg-pool hands a queued checkout to its callback from whichever request
 * released the client, so `pool.query` would run in that request's context.
 * Binding the callback where it was asked for keeps the scope and timing with
 * the request that sent the statement.
 */
export function bindPoolCheckouts(pool: Pool): void {
  const connect = pool.connect.bind(pool) as (...args: unknown[]) => unknown
  pool.connect = ((...args: unknown[]) => {
    const [callback] = args
    if (typeof callback !== 'function') return connect(...args)
    return connect(AsyncResource.bind(callback as (...results: unknown[]) => unknown))
  }) as typeof pool.connect
}
