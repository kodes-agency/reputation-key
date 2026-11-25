import type { ClientBase } from 'pg'
import { describe, expect, it } from 'vitest'
import { runInScope } from './scope-store.server'
import { scopeClientStatements, StatementScopeError } from './statement-scope.server'
import { withTenantScope } from './tenant-scope.server'

type Sent = { text: string; values: unknown }

/**
 * A client that answers each statement on a later tick, in the order sent,
 * like a connection. A statement whose text is in `failing` is refused.
 */
function fakeClient(failing: ReadonlySet<string> = new Set()) {
  const sent: Sent[] = []
  const query = (...args: unknown[]) => {
    const [first, second] = args
    const text = typeof first === 'string' ? first : (first as { text: string }).text
    if (text === 'throws') throw new Error('client is closed')
    const values =
      typeof first === 'string' ? second : (first as { values?: unknown }).values
    sent.push({ text, values: Array.isArray(values) ? values : undefined })
    const callback = args.find((arg) => typeof arg === 'function') as
      ((error: unknown, result?: unknown) => void) | undefined
    const outcome = new Promise((resolve, reject) =>
      setTimeout(() => {
        if (failing.has(text)) reject(new Error(`refused: ${text}`))
        else resolve({ rows: [{ text }] })
      }, 1),
    )
    if (callback) {
      outcome.then((result) => callback(undefined, result), callback)
      return undefined
    }
    return outcome
  }
  const client = { query } as unknown as ClientBase
  scopeClientStatements(client)
  return { client, sent }
}

const settings = (sent: readonly Sent[]) =>
  sent.filter((statement) => statement.text.includes('set_config'))

const tenant = (organizationId: string) =>
  ({ organizationId, entry: 'session', name: 'scope-test' }) as const

describe('statement scope on a pooled client', () => {
  it('sends an unscoped statement as it is on a fresh client', async () => {
    const { client, sent } = fakeClient()

    await client.query('select 1')

    expect(sent).toEqual([{ text: 'select 1', values: undefined }])
  })

  it('sets a tenant before its first statement and not again while it holds', async () => {
    const { client, sent } = fakeClient()

    await withTenantScope(tenant('org-a'), async () => {
      await client.query('select * from reviews')
      await client.query('select * from properties')
    })

    expect(sent.map((statement) => statement.text)).toEqual([
      expect.stringContaining('set_config'),
      'select * from reviews',
      'select * from properties',
    ])
    expect(settings(sent)[0]!.values).toEqual(['tenant', 'org-a'])
  })

  it('interleaving two tenants and an unscoped request on one client never runs one under another', async () => {
    const { client, sent } = fakeClient()

    await Promise.all([
      withTenantScope(tenant('org-a'), () => client.query('a1')),
      withTenantScope(tenant('org-b'), () => client.query('b1')),
      client.query('none'),
      runInScope({ kind: 'system', name: 'job:test' }, () => client.query('system')),
      withTenantScope(tenant('org-a'), () => client.query('a2')),
    ])

    // Each statement follows the setting for its own unit of work.
    expect(
      sent.map(({ text, values }) => (text.includes('set_config') ? values : text)),
    ).toEqual([
      ['tenant', 'org-a'],
      'a1',
      ['tenant', 'org-b'],
      'b1',
      ['', ''],
      'none',
      ['system', ''],
      'system',
      ['tenant', 'org-a'],
      'a2',
    ])
  })

  it('clears the tenant before the next unscoped user of the client', async () => {
    const { client, sent } = fakeClient()

    await withTenantScope(tenant('org-a'), () => client.query('a1'))
    await client.query('after')

    expect(settings(sent).map((statement) => statement.values)).toEqual([
      ['tenant', 'org-a'],
      ['', ''],
    ])
    expect(sent.at(-1)!.text).toBe('after')
  })

  it('serves callback-form statements in order behind the setting', async () => {
    const { client, sent } = fakeClient()

    const answered = await withTenantScope(
      tenant('org-a'),
      () =>
        new Promise((resolve, reject) => {
          ;(client.query as unknown as (...args: unknown[]) => void)(
            'select 1',
            [],
            (error: unknown, result: unknown) =>
              error ? reject(error) : resolve(result),
          )
        }),
    )

    expect(answered).toEqual({ rows: [{ text: 'select 1' }] })
    expect(sent.map((statement) => statement.text)).toEqual([
      expect.stringContaining('set_config'),
      'select 1',
    ])
  })

  it('sets the tenant before a statement sent as a query config, as the ORM sends it', async () => {
    const { client, sent } = fakeClient()

    await withTenantScope(tenant('org-a'), () =>
      client.query({ text: 'select * from reviews where id = $1', values: ['r1'] }),
    )

    expect(sent).toEqual([
      expect.objectContaining({ values: ['tenant', 'org-a'] }),
      { text: 'select * from reviews where id = $1', values: ['r1'] },
    ])
    expect(sent[0]!.text).toContain('set_config')
  })

  it('leaves statements inside a transaction to the scope set before it began', async () => {
    const { client, sent } = fakeClient()

    await withTenantScope(tenant('org-a'), async () => {
      await client.query('begin')
      await withTenantScope(tenant('org-b'), () => client.query('inside'))
      await client.query('commit')
    })

    expect(settings(sent).map((statement) => statement.values)).toEqual([
      ['tenant', 'org-a'],
    ])
  })

  it('refuses the statement when its setting fails, and sets again for the next one', async () => {
    const failing = new Set<string>()
    const { client, sent } = fakeClient(failing)
    await withTenantScope(tenant('org-a'), () => client.query('a1'))
    failing.add(
      "select set_config('app.scope', $1, false), set_config('app.organization_id', $2, false)",
    )

    const refused = withTenantScope(tenant('org-b'), () => client.query('b1'))

    await expect(refused).rejects.toBeInstanceOf(StatementScopeError)
    expect(sent.map((statement) => statement.text)).not.toContain('b1')

    failing.clear()
    await withTenantScope(tenant('org-b'), () => client.query('b2'))
    expect(settings(sent).at(-1)!.values).toEqual(['tenant', 'org-b'])
    expect(sent.at(-1)!.text).toBe('b2')
  })

  it('answers a callback-form statement with the refusal when its setting fails', async () => {
    const failing = new Set([
      "select set_config('app.scope', $1, false), set_config('app.organization_id', $2, false)",
    ])
    const { client, sent } = fakeClient(failing)

    const answered = await withTenantScope(
      tenant('org-a'),
      () =>
        new Promise((resolve) => {
          // A statement nobody answers must fail this test, not hang it.
          const giveUp = setTimeout(() => resolve('unanswered'), 250)
          ;(client.query as unknown as (...args: unknown[]) => void)(
            'select 1',
            [],
            (error: unknown) => {
              clearTimeout(giveUp)
              resolve(error)
            },
          )
        }),
    )

    expect(answered).toBeInstanceOf(StatementScopeError)
    expect(sent.map((statement) => statement.text)).not.toContain('select 1')
  })

  it('rejects a statement queued behind a setting when sending it throws', async () => {
    const { client } = fakeClient()

    const answered = withTenantScope(tenant('org-a'), () => client.query('throws'))

    await expect(answered).rejects.toThrow('client is closed')
  })
})
