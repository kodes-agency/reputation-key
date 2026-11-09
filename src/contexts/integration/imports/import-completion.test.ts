import { describe, expect, it, vi } from 'vitest'
import type { Tx } from '#/shared/outbox/commit'
import { googleImportItems } from '#/shared/db/schema/google-import.schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { completeImportItem } from './import-completion.server'

const NOW = new Date('2026-10-20T10:00:00.000Z')

function setup(
  status: 'pending' | 'processing' | 'imported' | 'relinked',
  action = status === 'relinked' ? 'relink' : 'create',
) {
  const item = {
    id: 'item',
    organizationId: 'org',
    importId: 'parent',
    destinationPropertyId: 'property',
    action,
    status,
    outcomeCode: status === 'imported' || status === 'relinked' ? status : null,
    highestAttemptForRevision: 1,
  }
  const writes: unknown[] = []
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows = Promise.resolve(
            table === googleImportItems ? [item] : [{ firstTerminalAt: null }],
          )
          return Object.assign(rows, {
            limit: () => rows,
            for: () => ({ limit: () => rows }),
          })
        },
      }),
    }),
    update: () => ({
      set: (patch: unknown) => ({
        where: async () => {
          writes.push(patch)
        },
      }),
    }),
  } as unknown as Tx
  const receipt = {
    organizationId: organizationId('org'),
    idempotencyKey: 'item',
    destinationPropertyId: propertyId('property'),
    outcome: action === 'relink' ? ('relinked' as const) : ('imported' as const),
    destinationSourceEpoch: 1,
    destinationProfileVersion: 1,
    tombstone: false,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    retentionReleasedAt: null,
  }
  const deps = {
    readReceipt: vi.fn(async () => receipt),
    prepareImportSync: vi.fn(async () => undefined),
    ensureImportFollowUps: vi.fn(async () => undefined),
  }
  const complete = () =>
    completeImportItem(tx, deps, {
      organizationId: 'org',
      itemId: 'item',
      now: NOW,
      authority: { kind: 'receipt' },
    })
  return { deps, complete, writes, tx, receipt }
}

describe('receipt completion follow-up recovery', () => {
  it.each([
    ['pending', 'create'],
    ['processing', 'create'],
    ['pending', 'relink'],
    ['processing', 'relink'],
  ] as const)(
    'preserves follow-ups before completing an unfinished %s %s',
    async (status, action) => {
      const { deps, complete, writes, tx, receipt } = setup(status, action)

      await expect(complete()).resolves.toBe('completed')

      expect(deps.ensureImportFollowUps).toHaveBeenCalledExactlyOnceWith(tx, receipt, NOW)
      expect(writes).toContainEqual(expect.objectContaining({ status: receipt.outcome }))
    },
  )

  it.each(['imported', 'relinked'] as const)(
    'does not create follow-ups when reconciling an already %s item',
    async (status) => {
      const { deps, complete } = setup(status)

      await expect(complete()).resolves.toBe('completed')

      expect(deps.ensureImportFollowUps).not.toHaveBeenCalled()
    },
  )

  it('leaves the item unfinished when durable follow-ups cannot be preserved', async () => {
    const { deps, complete, writes } = setup('processing')
    deps.ensureImportFollowUps.mockRejectedValueOnce(new Error('outbox unavailable'))

    await expect(complete()).rejects.toThrow('outbox unavailable')

    expect(writes).toEqual([])
  })
})
