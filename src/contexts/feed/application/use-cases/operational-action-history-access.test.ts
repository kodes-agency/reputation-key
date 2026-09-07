import { describe, expect, it } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import type { OperationalActionHistoryStore } from '../../ports/operational-action-history-store.port'
import {
  operationalActionHistoryRecordId,
  type OperationalActionHistoryRecordId,
  type OperationalActionRecord,
} from '../../domain/operational-action-history'
import {
  exportOperationalActionHistory,
  listOperationalActionHistory,
} from './operational-action-history-access'

const NOW = new Date('2026-08-28T10:00:00.000Z')

const context = (role: Role): AuthContext => ({
  userId: userId(`user-${role}`),
  organizationId: organizationId('org-1'),
  role,
})

const record = (id: string): OperationalActionRecord => ({
  id: operationalActionHistoryRecordId(id),
  organizationId: organizationId('org-1'),
  propertyId: propertyId('property-1'),
  actorType: 'user',
  actorId: 'user-1',
  action: 'property.archived',
  outcome: 'succeeded',
  resourceType: 'property',
  resourceId: 'property-1',
  reasonCode: 'manager_requested',
  provenance: {
    kind: 'domain_fact',
    id: `event-${id}`,
    eventType: 'property.archived',
    eventVersion: 1,
    sourceContext: 'property',
    sourceAggregateId: 'property-1',
  },
  occurredAt: new Date('2026-08-28T09:00:00.000Z'),
  recordedAt: new Date('2026-08-28T09:00:01.000Z'),
})

const storeFixture = () => {
  const appended: OperationalActionRecord[] = []
  const reads: Array<Parameters<OperationalActionHistoryStore['readWithAccess']>[0]> = []
  const store: OperationalActionHistoryStore = {
    append: async (entry) => {
      appended.push(entry)
      return { status: 'appended', sequence: appended.length }
    },
    readWithAccess: async (input) => {
      reads.push(input)
      return {
        items: [
          {
            ...record('00000000-0000-4000-8000-000000000777'),
            sequence: 7,
            actorRedactedAt: null,
            resourceRedactedAt: null,
          },
        ],
        nextCursor: null,
      }
    },
    readReadiness: async () => ({
      lastSequence: 0,
      coveredSequenceCount: 0,
      duplicateSequenceCount: 0,
      minimumSequence: null,
      maximumSequence: null,
      oldestRecordAt: null,
      newestRecordAt: null,
      activeLegalHoldCount: 0,
    }),
    assessRetention: async () => ({
      eligibleCount: 0,
      heldCount: 0,
      oldestEligibleAt: null,
    }),
    placeLegalHold: async (input) => ({ status: 'placed', holdId: input.hold.id }),
    releaseLegalHold: async () => 'released',
    redactSubject: async () => ({
      status: 'applied',
      redacted: 0,
      held: 0,
      complete: true,
    }),
  }
  return { store, appended, reads }
}

const dependencies = (
  store: OperationalActionHistoryStore,
  canonicalAccountAdmin: boolean,
) => {
  let next = 900
  return {
    store,
    accessAuthority: {
      isCurrentAccountAdmin: async () => canonicalAccountAdmin,
    },
    clock: () => NOW,
    idGen: (): OperationalActionHistoryRecordId =>
      operationalActionHistoryRecordId(
        `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`,
      ),
  }
}

describe('restricted Operational Action History access', () => {
  it('denies a PropertyManager, durably records the denied attempt, and returns no rows', async () => {
    const fixture = storeFixture()

    await expect(
      listOperationalActionHistory(dependencies(fixture.store, false))(
        { limit: 20 },
        context('PropertyManager'),
      ),
    ).rejects.toMatchObject({
      _tag: 'ActivityError',
      code: 'operational_history_access_denied',
    })

    expect(fixture.reads).toEqual([])
    expect(fixture.appended).toHaveLength(1)
    expect(fixture.appended[0]).toMatchObject({
      organizationId: 'org-1',
      actorType: 'user',
      actorId: 'user-PropertyManager',
      action: 'operational_history.accessed',
      outcome: 'denied',
      resourceType: 'operational_history',
    })
  })

  it('fails closed when a session says AccountAdmin but current authority does not', async () => {
    const fixture = storeFixture()

    await expect(
      listOperationalActionHistory(dependencies(fixture.store, false))(
        {},
        context('AccountAdmin'),
      ),
    ).rejects.toMatchObject({ code: 'operational_history_access_denied' })
    expect(fixture.reads).toEqual([])
    expect(fixture.appended[0]?.outcome).toBe('denied')
  })

  it('uses current AccountAdmin authority independently of a stale token role, forces tenant scope, and caps a page at 100', async () => {
    const fixture = storeFixture()
    const result = await listOperationalActionHistory(dependencies(fixture.store, true))(
      {
        limit: 500,
        propertyId: propertyId('property-1'),
        action: 'property.archived',
      },
      context('PropertyManager'),
    )

    expect(result.items).toHaveLength(1)
    expect(fixture.appended).toEqual([])
    expect(fixture.reads).toHaveLength(1)
    expect(fixture.reads[0]).toMatchObject({
      query: {
        organizationId: 'org-1',
        propertyId: 'property-1',
        action: 'property.archived',
        limit: 100,
        observedAt: NOW,
      },
      accessRecord: {
        action: 'operational_history.accessed',
        outcome: 'succeeded',
      },
    })
  })

  it('returns a deterministic identifier-only export and audits it atomically', async () => {
    const fixture = storeFixture()
    const run = exportOperationalActionHistory(dependencies(fixture.store, true))

    const first = await run({ limit: 600 }, context('AccountAdmin'))
    const second = await run({ limit: 600 }, context('AccountAdmin'))

    expect(first).toEqual(second)
    expect(first.formatVersion).toBe(1)
    expect(first.scope).toEqual({
      organizationId: 'org-1',
      propertyId: null,
      action: null,
      resourceType: null,
      cursor: null,
      limit: 500,
    })
    expect(first.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(first.items[0]).not.toHaveProperty('details')
    expect(first.items[0]).not.toHaveProperty('payload')
    expect(fixture.reads).toHaveLength(2)
    expect(fixture.reads[0]).toMatchObject({
      query: { organizationId: 'org-1', limit: 500, observedAt: NOW },
      accessRecord: {
        action: 'operational_history.exported',
        outcome: 'succeeded',
      },
    })
  })
})
