import { describe, expect, it, vi } from 'vitest'
import type { Tx } from '#/shared/outbox/commit'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type { PortalPublicationState } from '../domain/portal-publication'
import {
  fencePortalContent,
  fencePortalRevision,
  type PortalAggregateFence,
} from './portal-aggregate-fence'

const command: PortalAggregateFence = {
  organizationId: organizationId('organization'),
  propertyId: propertyId('property'),
  portalId: portalId('portal'),
  expectedPortalUpdatedAt: new Date('2026-11-01T10:00:00Z'),
  revision: new Date('2026-11-01T10:00:01Z'),
  occurredAt: new Date('2026-11-01T10:00:01Z'),
}

// Only the decision over UPDATE's locked result is faked here; the PostgreSQL
// regression checks rollback through a real content command.
function lockedResult(
  publicationState?: PortalPublicationState,
  updatedAt = command.revision,
) {
  const returning = vi.fn(async () =>
    publicationState === undefined ? [] : [{ updatedAt, publicationState }],
  )
  const update = vi.fn(() => ({
    set: () => ({ where: () => ({ returning }) }),
  }))
  return { tx: { update } as unknown as Tx, update, returning }
}

describe('fencePortalContent', () => {
  it('refuses content changes when the locked Portal is archived', async () => {
    const { tx } = lockedResult('archived')
    await expect(fencePortalContent(tx, command)).rejects.toMatchObject({
      code: 'portal_inactive',
    })
  })

  it.each(['draft', 'published', 'disabled'] as const)(
    'allows content changes on a %s Portal',
    async (state) => {
      const { tx } = lockedResult(state)
      await expect(fencePortalContent(tx, command)).resolves.toBeUndefined()
    },
  )

  it('refuses when the fenced update matches no Portal', async () => {
    const { tx } = lockedResult()
    await expect(fencePortalContent(tx, command)).rejects.toMatchObject({
      code: 'revision_conflict',
    })
  })

  it('refuses a database revision that diverges from the durable fact', async () => {
    const { tx } = lockedResult('draft', command.expectedPortalUpdatedAt)
    await expect(fencePortalContent(tx, command)).rejects.toMatchObject({
      code: 'revision_conflict',
    })
  })

  it.each([0, -1])(
    'refuses a non-advancing revision (%s ms) before writing',
    async (offset) => {
      const { tx, update } = lockedResult('draft')
      await expect(
        fencePortalContent(tx, {
          ...command,
          revision: new Date(command.expectedPortalUpdatedAt.getTime() + offset),
        }),
      ).rejects.toMatchObject({ code: 'revision_conflict' })
      expect(update).not.toHaveBeenCalled()
    },
  )
})

describe('fencePortalRevision', () => {
  it('keeps address management available on archived Portals', async () => {
    const { tx } = lockedResult('archived')
    await expect(fencePortalRevision(tx, command)).resolves.toBe('archived')
  })

  it('still fences stale address commands', async () => {
    const { tx } = lockedResult()
    await expect(fencePortalRevision(tx, command)).rejects.toMatchObject({
      code: 'revision_conflict',
    })
  })
})
