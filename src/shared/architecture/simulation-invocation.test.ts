import { describe, expect, it } from 'vitest'
import {
  assertDisposableSimulationBaseUrl,
  buildDisposableSimulationDatabaseTarget,
  buildSimulationInvocation,
} from '../../../scripts/simulation-invocation'

describe('simulation operator invocation', () => {
  it.each([
    'postgresql://test:test@localhost:5432/test',
    'postgresql://test:test@localhost:5432/repkey_scratch',
    'postgresql://test:test@localhost:5432/sim_local',
  ])('accepts an explicitly disposable simulation base %j', (baseUrl) => {
    expect(() => assertDisposableSimulationBaseUrl(baseUrl)).not.toThrow()
  })

  it.each([
    'postgresql://dev:dev@localhost:5432/repkey_dev',
    'postgresql://dev:dev@localhost:5432/contest',
    'https://localhost/test',
  ])('rejects a non-disposable simulation base %j', (baseUrl) => {
    expect(() => assertDisposableSimulationBaseUrl(baseUrl)).toThrow(
      /disposable|PostgreSQL/,
    )
  })

  it('passes a database-derived organization id as one argv value without a shell', () => {
    const hostile = 'org-1; touch /tmp/repkey-should-not-exist'

    const invocation = buildSimulationInvocation(hostile)

    expect(invocation.file).toBe(process.execPath)
    expect(invocation.args.slice(-3)).toEqual([
      'scripts/seed.ts',
      `--org=${hostile}`,
      '--invariants',
    ])
    expect(invocation.options.shell).toBe(false)
  })

  it('derives an exact disposable database from a local PostgreSQL base URL', () => {
    expect(
      buildDisposableSimulationDatabaseTarget(
        'postgresql://test:secret@127.0.0.1:5432/test?sslmode=disable',
        '0123456789abcdef',
      ),
    ).toEqual({
      databaseName: 'repkey_sim_0123456789abcdef',
      databaseUrl:
        'postgresql://test:secret@127.0.0.1:5432/repkey_sim_0123456789abcdef?sslmode=disable',
      maintenanceUrl: 'postgresql://test:secret@127.0.0.1:5432/postgres?sslmode=disable',
    })
  })

  it.each(['../prod', 'contains space', '', 'ABC'])(
    'rejects an unsafe disposable database suffix %j',
    (suffix) => {
      expect(() =>
        buildDisposableSimulationDatabaseTarget(
          'postgresql://test:test@localhost:5432/test',
          suffix,
        ),
      ).toThrow(/suffix/)
    },
  )
})
