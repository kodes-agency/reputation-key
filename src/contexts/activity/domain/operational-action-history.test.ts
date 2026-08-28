import { describe, expect, it } from 'vitest'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import {
  OPERATIONAL_ACTION_KINDS,
  createOperationalActionRecord,
  operationalActionHistoryRecordId,
} from './operational-action-history'

const OCCURRED_AT = new Date('2026-08-28T09:00:00.000Z')
const RECORDED_AT = new Date('2026-08-28T09:00:02.000Z')

const validInput = {
  id: operationalActionHistoryRecordId('00000000-0000-4000-8000-000000000111'),
  organizationId: organizationId('org-1'),
  propertyId: propertyId('property-1'),
  actorType: 'user' as const,
  actorId: userId('user-1'),
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
  occurredAt: OCCURRED_AT,
  recordedAt: RECORDED_AT,
}

describe('Operational Action History record contract', () => {
  it('constructs an identifier-only eligible record without a generic payload', () => {
    const result = createOperationalActionRecord(validInput)

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw new Error('unreachable')
    expect(result.value).toEqual(validInput)
    expect(result.value).not.toHaveProperty('details')
    expect(result.value).not.toHaveProperty('payload')
  })

  it('accepts every explicit action/resource pair and rejects cross-pair drift', () => {
    for (const [index, kind] of OPERATIONAL_ACTION_KINDS.entries()) {
      const result = createOperationalActionRecord({
        ...validInput,
        id: operationalActionHistoryRecordId(
          `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        ),
        ...kind,
      })
      expect(result.isOk(), `${kind.action}/${kind.resourceType}`).toBe(true)
    }

    const result = createOperationalActionRecord({
      ...validInput,
      action: 'property.archived',
      resourceType: 'reply',
    })
    expect(result.isErr()).toBe(true)
    if (!result.isErr()) throw new Error('unreachable')
    expect(result.error.code).toBe('invalid_operational_action_kind')
  })

  it('requires complete source-event provenance without inventing it for commands', () => {
    const missingVersion = createOperationalActionRecord({
      ...validInput,
      provenance: { ...validInput.provenance, eventVersion: 0 },
    })
    expect(missingVersion.isErr()).toBe(true)
    if (!missingVersion.isErr()) throw new Error('unreachable')
    expect(missingVersion.error.code).toBe('invalid_operational_action_provenance')

    const inventedEvent = createOperationalActionRecord({
      ...validInput,
      provenance: {
        kind: 'interactive_command',
        id: 'command-1',
        eventType: 'property.archived',
        eventVersion: 1,
        sourceContext: 'property',
        sourceAggregateId: 'property-1',
      },
    })
    expect(inventedEvent.isErr()).toBe(true)
    if (!inventedEvent.isErr()) throw new Error('unreachable')
    expect(inventedEvent.error.code).toBe('invalid_operational_action_provenance')
  })

  it.each([
    ['resourceId', 'review text with spaces'],
    ['reasonCode', 'manager said: delete this customer'],
  ] as const)('rejects content-like %s values', (field, value) => {
    const result = createOperationalActionRecord({ ...validInput, [field]: value })
    expect(result.isErr()).toBe(true)
    if (!result.isErr()) throw new Error('unreachable')
    expect(result.error.code).toBe('invalid_operational_action_identifier')
  })

  it('requires an actor identifier exactly when the actor kind is attributable', () => {
    const missingUser = createOperationalActionRecord({
      ...validInput,
      actorId: null,
    })
    expect(missingUser.isErr()).toBe(true)

    const publicDecision = createOperationalActionRecord({
      ...validInput,
      actorType: 'public',
      actorId: null,
      action: 'authentication.decision',
      resourceType: 'account',
      resourceId: null,
      provenance: {
        kind: 'policy_decision',
        id: 'decision-1',
        eventType: null,
        eventVersion: null,
        sourceContext: null,
        sourceAggregateId: null,
      },
    })
    expect(publicDecision.isOk()).toBe(true)
  })
})
