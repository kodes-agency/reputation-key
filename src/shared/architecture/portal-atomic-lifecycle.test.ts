// ARC-01 governance guard for the migrated Portal lifecycle slice.
// Real PostgreSQL tests prove atomic behavior; this guard prevents later
// wiring from silently returning to state-write-then-emit paths.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { EVENT_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'

const CORE_USE_CASES = [
  'src/contexts/portal/application/use-cases/create-portal.ts',
  'src/contexts/portal/application/use-cases/update-portal.ts',
  'src/contexts/portal/application/use-cases/soft-delete-portal.ts',
  'src/contexts/portal/application/use-cases/update-link-category.ts',
  'src/contexts/portal/application/use-cases/delete-link-category.ts',
  'src/contexts/portal/application/use-cases/update-link.ts',
  'src/contexts/portal/application/use-cases/delete-link.ts',
] as const

const read = (path: string): string => readFileSync(path, 'utf8')

describe('architecture: core Portal lifecycle facts are atomic', () => {
  it('routes core and active content mutations through PortalCommandStore only', () => {
    for (const file of CORE_USE_CASES) {
      const source = read(file)
      expect(source, `${file} must call the Portal command store`).toContain(
        'deps.commandStore.',
      )
      expect(
        source,
        `${file} must not write Portal state through the repository`,
      ).not.toMatch(/portalRepo\.(?:insert|update|softDelete)\s*\(/)
      expect(
        source,
        `${file} must not revoke tokens outside the command transaction`,
      ).not.toMatch(/portalTokenRepo\.revokeForPortal\s*\(/)
    }
  })

  it('constructs one atomic command store in the Portal composition boundary', () => {
    const source = read('src/contexts/portal/build.ts')
    expect(source).toContain('createAtomicPortalCommandStore(deps.db)')
    expect(source).toContain('commandStore: portalCommandStore')
  })

  it('catalogues every migrated lifecycle family as registered and replay-unique', () => {
    for (const eventType of ['portal.created', 'portal.updated', 'portal.deleted']) {
      expect(EVENT_FAMILY_ROWS.find((row) => row.eventType === eventType)).toMatchObject({
        schemaRegistered: true,
        recordedInOutbox: true,
        idempotencyKey: 'eventId',
      })
    }

    for (const eventType of [
      'portal.publication.published',
      'portal.publication.rolled_back',
      'portal.archived',
      'portal.restored',
    ]) {
      expect(EVENT_FAMILY_ROWS.find((row) => row.eventType === eventType)).toMatchObject({
        schemaRegistered: true,
        recordedInOutbox: true,
        idempotencyKey: 'eventId+consumerName',
      })
    }
  })

  it('leaves no partial responsibility-fact writer in PortalRepository', () => {
    const source = read(
      'src/contexts/portal/infrastructure/repositories/portal.repository.ts',
    )
    expect(source).not.toContain('insertOutboxRow')
    expect(source).not.toContain('responsibilityNeededEvent')
  })

  it('keeps the production PortalRepository read-only', () => {
    const port = read('src/contexts/portal/application/ports/portal.repository.ts')
    const implementation = read(
      'src/contexts/portal/infrastructure/repositories/portal.repository.ts',
    )

    for (const mutation of ['insert', 'update', 'softDelete']) {
      expect(port, `PortalRepository must not expose ${mutation}`).not.toMatch(
        new RegExp(`\\b${mutation}\\s*:`),
      )
      expect(
        implementation,
        `production PortalRepository must not implement ${mutation}`,
      ).not.toMatch(new RegExp(`\\b${mutation}\\s*:`))
    }
    expect(implementation).not.toContain('#/shared/testing/')
    const fixturePath =
      'src/contexts/portal/infrastructure/testing/postgres-portal-fixture-store.ts'
    expect(read(fixturePath)).toContain('Test-only Portal state seeding/mutation')
    expect(read('src/contexts/portal/build.ts')).not.toContain(fixturePath)
  })

  it('captures child state and the Portal revision in one update/delete snapshot', () => {
    for (const file of [
      'src/contexts/portal/application/use-cases/update-link.ts',
      'src/contexts/portal/application/use-cases/delete-link.ts',
    ]) {
      expect(read(file)).toContain('findLinkCommandTarget')
    }
    for (const file of [
      'src/contexts/portal/application/use-cases/update-link-category.ts',
      'src/contexts/portal/application/use-cases/delete-link-category.ts',
    ]) {
      expect(read(file)).toContain('findCategoryCommandTarget')
    }
    const implementation = read(
      'src/contexts/portal/infrastructure/repositories/portal-link.repository.ts',
    )
    expect(implementation).toContain('portalUpdatedAt: portals.updatedAt')
  })
})
