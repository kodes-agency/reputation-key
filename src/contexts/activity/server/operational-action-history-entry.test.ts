import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ENTRY_POINT_CATALOGUE } from '#/shared/governance/entry-point-catalogue'

const source = readFileSync(
  resolve(process.cwd(), 'src/contexts/activity/server/activity.ts'),
  'utf8',
)

describe('Operational Action History server reachability', () => {
  it('declares both restricted GET boundaries behind policy.admin', () => {
    for (const name of [
      'listOperationalActionHistoryFn',
      'exportOperationalActionHistoryFn',
    ]) {
      const start = source.indexOf(`export const ${name}`)
      const end = source.indexOf('\nexport const ', start + 1)
      const declaration = source.slice(start, end === -1 ? source.length : end)
      expect(start).toBeGreaterThan(-1)
      expect(declaration).toContain("createServerFn({ method: 'GET' })")
      expect(declaration).toContain('setOperationalHistoryResponsePrivacy()')
      expect(declaration).toContain("action: 'policy.admin'")
      expect(declaration).toContain('activityPublicApi.')
      expect(declaration).not.toContain('.role')
    }
    expect(source).toContain("'Cache-Control', 'private, no-store, max-age=0'")
    expect(source).toContain("'Vary', 'Cookie'")
    expect(source).toContain("'Referrer-Policy', 'no-referrer'")
  })

  it('catalogues their direct reachability and Activity-local access evidence', () => {
    const rows = ENTRY_POINT_CATALOGUE.filter(({ name }) =>
      ['listOperationalActionHistoryFn', 'exportOperationalActionHistoryFn'].includes(
        name,
      ),
    )
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row).toMatchObject({
        owner: 'activity',
        action: 'policy.admin',
        capability: 'identity.invite',
        resourceScope: 'organization',
        principals: ['user'],
        registration: { reachability: 'direct_declaration' },
        mutation: {
          kind: 'mutation',
          stateOwner: 'activity',
          disposition: 'local_only_with_reason',
        },
      })
    }
  })
})
