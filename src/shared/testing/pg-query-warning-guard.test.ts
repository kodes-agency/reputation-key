import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { createPgQueryWarningGuard } from './pg-query-warning-guard'

const concurrentWarning = () =>
  Object.assign(
    new Error(
      'Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.',
    ),
    { name: 'DeprecationWarning' },
  )

describe('integration PostgreSQL query warning guard', () => {
  it('fails for the driver warning and retains its original stack', () => {
    const guard = createPgQueryWarningGuard()
    const events = new EventEmitter()
    events.on('warning', guard.onWarning)
    const warning = concurrentWarning()

    events.emit('warning', warning)

    let failure: unknown
    try {
      guard.assertNoWarnings()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([warning])
    expect(() => guard.assertNoWarnings()).not.toThrow()
  })

  it('allows a clean run and unrelated deprecations', () => {
    const guard = createPgQueryWarningGuard()
    guard.onWarning(
      Object.assign(new Error('An unrelated deprecation'), {
        name: 'DeprecationWarning',
      }),
    )
    expect(() => guard.assertNoWarnings()).not.toThrow()
  })
})
