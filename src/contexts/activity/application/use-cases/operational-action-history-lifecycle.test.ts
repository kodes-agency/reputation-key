import { describe, expect, it } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type {
  OperationalActionHistoryReadinessSnapshot,
  OperationalActionHistoryStore,
} from '../../ports/operational-action-history-store.port'
import {
  operationalActionHistoryRecordId,
  type OperationalActionHistoryRecordId,
  type OperationalActionRecord,
} from '../../domain/operational-action-history'
import {
  appendOperationalAction,
  assessOperationalActionHistoryRetention,
  getOperationalActionHistoryReadiness,
  placeOperationalActionHistoryLegalHold,
  redactOperationalActionHistorySubject,
  releaseOperationalActionHistoryLegalHold,
} from './operational-action-history-lifecycle'

const NOW = new Date('2026-08-28T12:00:00.000Z')
const ORG = organizationId('org-1')

const storeFixture = () => {
  const appended: OperationalActionRecord[] = []
  const holds: unknown[] = []
  const releases: unknown[] = []
  const redactions: unknown[] = []
  let appendOutcomes: Array<'appended' | 'duplicate'> = ['appended']
  let readinessFailure = false
  let readiness: OperationalActionHistoryReadinessSnapshot = {
    lastSequence: 3,
    coveredSequenceCount: 3,
    duplicateSequenceCount: 0,
    minimumSequence: 1,
    maximumSequence: 3,
    oldestRecordAt: new Date('2026-08-01T00:00:00.000Z'),
    newestRecordAt: new Date('2026-08-28T11:00:00.000Z'),
    activeLegalHoldCount: 0,
  }
  const store: OperationalActionHistoryStore = {
    append: async (record) => {
      appended.push(record)
      return {
        status: appendOutcomes.shift() ?? 'appended',
        sequence: appended.length,
      }
    },
    readWithAccess: async () => ({ items: [], nextCursor: null }),
    readReadiness: async () => {
      if (readinessFailure) throw new Error('database unavailable')
      return readiness
    },
    assessRetention: async () => ({
      eligibleCount: 2,
      heldCount: 1,
      oldestEligibleAt: new Date('2025-01-01T00:00:00.000Z'),
    }),
    placeLegalHold: async (input) => {
      holds.push(input)
      return { status: 'placed', holdId: input.hold.id }
    },
    releaseLegalHold: async (input) => {
      releases.push(input)
      return 'released'
    },
    redactSubject: async (input) => {
      redactions.push(input)
      return {
        status: 'applied',
        redacted: 4,
        held: 1,
        complete: false,
      }
    },
  }
  return {
    store,
    appended,
    holds,
    releases,
    redactions,
    setReadiness: (next: typeof readiness) => {
      readiness = next
    },
    setReadinessFailure: () => {
      readinessFailure = true
    },
    setAppendOutcomes: (outcomes: Array<'appended' | 'duplicate'>) => {
      appendOutcomes = outcomes
    },
  }
}

const deps = (store: OperationalActionHistoryStore) => {
  let next = 100
  return {
    store,
    clock: () => NOW,
    idGen: (): OperationalActionHistoryRecordId =>
      operationalActionHistoryRecordId(
        `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`,
      ),
    holdIdGen: () => '00000000-0000-4000-8000-000000000500',
  }
}

const sourceAction = {
  organizationId: ORG,
  propertyId: propertyId('property-1'),
  actorType: 'user' as const,
  actorId: 'user-1',
  action: 'property.archived' as const,
  outcome: 'succeeded' as const,
  resourceType: 'property' as const,
  resourceId: 'property-1',
  reasonCode: 'manager_requested',
  provenance: {
    kind: 'domain_fact' as const,
    id: 'event-1',
    eventType: 'property.archived',
    eventVersion: 1,
    sourceContext: 'property',
    sourceAggregateId: 'property-1',
  },
  occurredAt: new Date('2026-08-28T11:00:00.000Z'),
}

describe('Operational Action History durability and lifecycle', () => {
  it('appends an exact canonical source action and makes duplicate retry a success', async () => {
    const fixture = storeFixture()
    fixture.setAppendOutcomes(['appended', 'duplicate'])
    const run = appendOperationalAction(deps(fixture.store))

    await expect(run(sourceAction)).resolves.toEqual({ status: 'appended', sequence: 1 })
    await expect(run(sourceAction)).resolves.toEqual({ status: 'duplicate', sequence: 2 })
    expect(fixture.appended[0]).toMatchObject({
      provenance: { kind: 'domain_fact', id: 'event-1' },
      recordedAt: NOW,
    })
  })

  it('reports sequence readiness honestly and never claims cryptographic integrity', async () => {
    const fixture = storeFixture()
    const read = getOperationalActionHistoryReadiness({ store: fixture.store })

    await expect(read({ organizationId: ORG, observedAt: NOW })).resolves.toEqual({
      state: 'ready',
      reason: 'sequence_current',
      observedAt: NOW,
      retentionMode: 'report_only_pending_counsel',
      lastSequence: 3,
      coveredSequenceCount: 3,
      duplicateSequenceCount: 0,
      minimumSequence: 1,
      maximumSequence: 3,
      oldestRecordAt: new Date('2026-08-01T00:00:00.000Z'),
      newestRecordAt: new Date('2026-08-28T11:00:00.000Z'),
      activeLegalHoldCount: 0,
    })

    fixture.setReadiness({
      lastSequence: 3,
      coveredSequenceCount: 2,
      duplicateSequenceCount: 0,
      minimumSequence: 1,
      maximumSequence: 2,
      oldestRecordAt: null,
      newestRecordAt: null,
      activeLegalHoldCount: 0,
    })
    await expect(read({ organizationId: ORG, observedAt: NOW })).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'unaccounted_sequence_gap',
    })
  })

  it('returns unknown readiness rather than zero when the authority store fails', async () => {
    const fixture = storeFixture()
    fixture.setReadinessFailure()

    await expect(
      getOperationalActionHistoryReadiness({ store: fixture.store })({
        organizationId: ORG,
        observedAt: NOW,
      }),
    ).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'authority_store_unavailable',
      lastSequence: null,
      coveredSequenceCount: null,
    })
  })

  it('assesses the 365-day horizon without exposing a destructive apply path', async () => {
    const fixture = storeFixture()
    const result = await assessOperationalActionHistoryRetention(deps(fixture.store))({
      organizationId: ORG,
      operatorId: 'operator-1',
      correlationId: 'retention-assessment-1',
    })

    expect(result).toEqual({
      mode: 'report_only_pending_counsel',
      cutoff: new Date('2025-08-28T12:00:00.000Z'),
      eligibleCount: 2,
      heldCount: 1,
      oldestEligibleAt: new Date('2025-01-01T00:00:00.000Z'),
    })
    expect(fixture.store).not.toHaveProperty('applyRetention')
  })

  it('places and releases a time-bounded hold with an atomic history record', async () => {
    const fixture = storeFixture()
    const dependencies = deps(fixture.store)
    const placed = await placeOperationalActionHistoryLegalHold(dependencies)({
      organizationId: ORG,
      operatorId: 'operator-1',
      correlationId: 'hold-place-1',
      reasonCode: 'legal_request',
      protectsFrom: new Date('2026-01-01T00:00:00.000Z'),
      protectsThrough: null,
    })
    const released = await releaseOperationalActionHistoryLegalHold(dependencies)({
      organizationId: ORG,
      holdId: placed.holdId,
      operatorId: 'operator-1',
      correlationId: 'hold-release-1',
      reasonCode: 'legal_request_closed',
    })

    expect(placed.status).toBe('placed')
    expect(released.status).toBe('released')
    expect(fixture.holds[0]).toMatchObject({
      hold: {
        organizationId: 'org-1',
        reasonCode: 'legal_request',
        protectsThrough: null,
      },
      actionRecord: { action: 'operational_history.legal_hold_placed' },
    })
    expect(fixture.releases[0]).toMatchObject({
      actionRecord: { action: 'operational_history.legal_hold_released' },
    })
  })

  it('redacts only identifier fields in bounded batches and reports held rows', async () => {
    const fixture = storeFixture()
    const result = await redactOperationalActionHistorySubject(deps(fixture.store))({
      organizationId: ORG,
      operatorId: 'operator-1',
      correlationId: 'redaction-1',
      subjectType: 'actor',
      subjectId: 'user-1',
      reasonCode: 'privacy_request',
      limit: 1_000,
    })

    expect(result).toEqual({
      status: 'applied',
      redacted: 4,
      held: 1,
      complete: false,
    })
    expect(fixture.redactions[0]).toMatchObject({
      subjectType: 'actor',
      subjectId: 'user-1',
      limit: 100,
      redactedAt: NOW,
      actionRecord: { action: 'operational_history.redaction_applied' },
    })
  })
})
