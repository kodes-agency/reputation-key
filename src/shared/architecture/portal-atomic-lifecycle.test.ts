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
] as const

const read = (path: string): string => readFileSync(path, 'utf8')

describe('architecture: core Portal lifecycle facts are atomic', () => {
  it('routes create, update, and delete through PortalCommandStore only', () => {
    for (const file of CORE_USE_CASES) {
      const source = read(file)
      expect(source, `${file} must call the Portal command store`).toContain(
        'deps.commandStore.',
      )
      expect(
        source,
        `${file} must not use the legacy post-write outbox helper`,
      ).not.toContain('emitAndRecord')
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
    expect(source).toContain('createAtomicPortalCommandStore(deps.db, deps.events)')
    expect(source.match(/commandStore: portalCommandStore/g)).toHaveLength(3)
  })

  it('catalogues every migrated lifecycle family as registered and replay-unique', () => {
    for (const eventType of ['portal.created', 'portal.updated', 'portal.deleted']) {
      expect(EVENT_FAMILY_ROWS.find((row) => row.eventType === eventType)).toMatchObject({
        schemaRegistered: true,
        recordedInOutbox: true,
        idempotencyKey: 'eventId',
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
})
