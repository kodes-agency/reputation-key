// Every statement a pooled client sends runs under the database scope of the
// unit of work that sent it. Outside a transaction the client's session
// carries `app.scope` and `app.organization_id`; before each statement whose
// scope differs from what the session holds, the client sets them first. The
// statement waits for that setting and fails if it did not take, so no
// statement ever runs under another request's or job's tenant, whatever
// unit of work last used the client. Transactions set the same values
// locally (`createDatabase`), and a statement inside a transaction runs as
// sent: its scope was settled before BEGIN.

import { performance } from 'node:perf_hooks'
import type { ClientBase } from 'pg'
import { recordScopeSetting, statementShape } from './scope-observation.server'
import { currentScope, type DatabaseScope } from './scope-store.server'

const SET_SCOPE =
  "select set_config('app.scope', $1, false), set_config('app.organization_id', $2, false)"

/** What the session holds when no scope has been set on it. */
const UNSCOPED = ''
/** A setting failed: no statement's scope matches until another succeeds. */
const UNKNOWN = '\u0000unknown'

type ClientScope = {
  /** The scope the client's session holds, as far as a completed setting proved. */
  applied: string | undefined
  /** The scope the last setting sent (or will send) asks for. */
  requested: string
  inTransaction: boolean
  failure: unknown
  /** Settled once every queued setting and statement has been sent, in order. */
  tail: Promise<void> | undefined
}

type Query = (...args: unknown[]) => unknown

/** A statement's answer as a promise, even when sending it throws. */
function sent(query: Query, args: readonly unknown[]): Promise<unknown> {
  try {
    return Promise.resolve(query(...args))
  } catch (error) {
    return Promise.reject(error)
  }
}

export class StatementScopeError extends Error {
  constructor(cause: unknown) {
    super('database scope could not be set for this statement', { cause })
    this.name = 'StatementScopeError'
  }
}

export function scopeKey(scope: DatabaseScope | undefined): string {
  if (!scope) return UNSCOPED
  return scope.kind === 'tenant' ? `tenant:${scope.organizationId}` : 'system'
}

function scopeValues(scope: DatabaseScope | undefined): [string, string] {
  if (!scope) return [UNSCOPED, UNSCOPED]
  return [scope.kind, scope.kind === 'tenant' ? scope.organizationId : '']
}

function statementText(args: readonly unknown[]): string | undefined {
  const [first] = args
  if (typeof first === 'string') return first
  if (first && typeof first === 'object' && 'text' in first) {
    const text = (first as { text?: unknown }).text
    return typeof text === 'string' ? text : undefined
  }
  return undefined
}

function after(state: ClientScope, work: () => Promise<unknown> | void): void {
  const done = state.tail ? state.tail.then(work) : work()
  if (!done) return
  const tail = done.then(
    () => undefined,
    () => undefined,
  )
  state.tail = tail
  void tail.then(() => {
    if (state.tail === tail) state.tail = undefined
  })
}

function setScope(
  state: ClientScope,
  query: Query,
  scope: DatabaseScope | undefined,
  key: string,
): void {
  state.requested = key
  after(state, () => {
    const started = performance.now()
    return sent(query, [SET_SCOPE, scopeValues(scope)]).then(
      () => {
        state.applied = key
        recordScopeSetting(performance.now() - started)
      },
      (error: unknown) => {
        // Unknown until a later setting succeeds; the next statement sets again.
        state.failure = error
        state.applied = undefined
        state.requested = UNKNOWN
      },
    )
  })
}

/**
 * Send a statement once everything queued before it has been sent. With a
 * `key`, the statement is refused unless the session holds that scope.
 */
function queued(
  state: ClientScope,
  query: Query,
  args: unknown[],
  key: string | undefined,
): unknown {
  const last = args.length - 1
  const callback = typeof args[last] === 'function' ? (args[last] as Query) : undefined
  const refused = (): StatementScopeError | undefined =>
    key === undefined || state.applied === key
      ? undefined
      : new StatementScopeError(state.failure)
  if (callback) {
    after(state, () => {
      const error = refused()
      if (error) {
        callback(error)
        return
      }
      try {
        query(...args)
      } catch (thrown) {
        callback(thrown)
      }
    })
    return undefined
  }
  return new Promise((resolve, reject) => {
    after(state, () => {
      const error = refused()
      if (error) return reject(error)
      sent(query, args).then(resolve, reject)
    })
  })
}

/**
 * Make every statement on this physical client run under the scope of the
 * unit of work that sends it. Applied once per connection, beneath the
 * observer, so observation sees each statement as the caller sent it.
 */
export function scopeClientStatements(client: ClientBase): void {
  const query = client.query.bind(client) as Query
  const state: ClientScope = {
    applied: UNSCOPED,
    requested: UNSCOPED,
    inTransaction: false,
    failure: undefined,
    tail: undefined,
  }
  client.query = ((...args: unknown[]) => {
    const text = statementText(args)
    if (text === undefined) return query(...args)
    const boundary = statementShape(text).boundary
    if (state.inTransaction) {
      if (boundary === 'end') state.inTransaction = false
      return state.tail ? queued(state, query, args, undefined) : query(...args)
    }
    if (boundary === 'begin') state.inTransaction = true
    const scope = currentScope()
    const key = scopeKey(scope)
    if (key !== state.requested) setScope(state, query, scope, key)
    if (!state.tail && state.applied === key) return query(...args)
    return queued(state, query, args, key)
  }) as typeof client.query
}
