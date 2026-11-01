import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { renamePersonalPortalLabels } from './rename-personal-portal-labels'
import { writePersonalPortalLabels } from '../../infrastructure/adapters/personal-portal-labels.writer'

describe('staff name transaction in Portal', () => {
  it('writes only the manager label and advances the Portal revision monotonically', async () => {
    const execute = vi.fn(async (_query: import('drizzle-orm').SQL) => undefined)
    const at = new Date('2026-11-01T12:00:00Z')
    await renamePersonalPortalLabels({
      write: writePersonalPortalLabels,
      clock: () => at,
    })(
      { portalIds: ['11111111-1111-4111-8111-111111111111'], displayName: 'Polly Jones' },
      buildTestAuthContext(),
      { execute },
    )
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]!)
    expect(query.sql).toContain("kind = 'personal'")
    expect(query.sql).toContain("updated_at + interval '1 millisecond'")
    expect(query.sql).not.toContain('public_name')
    expect(query.sql).not.toContain('slug')
    expect(query.params).toContain('Polly Jones')
  })
  it('refuses a staff login before the transaction writer runs', async () => {
    const write = vi.fn()
    await expect(
      renamePersonalPortalLabels({ write, clock: () => new Date() })(
        { portalIds: ['portal'], displayName: 'Polly Jones' },
        buildTestAuthContext({ role: 'Member' }),
        {},
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(write).not.toHaveBeenCalled()
  })
})
