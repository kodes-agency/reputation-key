import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import { parseAuditEvent } from './event.server'

const event = () => ({
  organizationId: 'org-1',
  propertyId: null,
  actorType: 'user',
  actorId: 'user-1',
  action: 'property.archived',
  outcome: 'succeeded',
  resourceType: 'property',
  resourceId: 'property-1',
  sourceKind: 'domain_fact',
  sourceId: 'event-1',
  sourceEventType: 'property.archived',
  sourceEventVersion: 1,
  sourceContext: 'property',
  sourceAggregateId: 'property-1',
  occurredAt: new Date('2026-11-07T10:00:00Z'),
})

describe('content-free audit events', () => {
  it('accepts stable source identity and optional actor/Property attribution', () => {
    expect(parseAuditEvent(event())).toEqual(event())
    expect(
      parseAuditEvent({ ...event(), actorType: 'system', actorId: null }),
    ).toMatchObject({ actorId: null })
  })

  it.each(['details', 'payload', 'body', 'actorName', 'ipAddress', 'reason'])(
    'refuses a %s field instead of silently discarding content',
    (key) => {
      expect(() =>
        parseAuditEvent({ ...event(), [key]: 'private customer content' }),
      ).toThrow(ZodError)
    },
  )

  it.each([
    'organizationId',
    'propertyId',
    'actorId',
    'resourceId',
    'sourceId',
    'sourceAggregateId',
  ])('refuses prose in %s', (key) => {
    expect(() =>
      parseAuditEvent({ ...event(), [key]: 'private customer content' }),
    ).toThrow(ZodError)
  })

  it('requires complete domain-fact provenance without inventing it for commands', () => {
    expect(() => parseAuditEvent({ ...event(), sourceEventVersion: null })).toThrow(
      'Invalid audit source identity',
    )
    expect(() => parseAuditEvent({ ...event(), sourceEventVersion: 0 })).toThrow(ZodError)
    expect(() => parseAuditEvent({ ...event(), sourceKind: 'operator_command' })).toThrow(
      'Invalid audit source identity',
    )
    expect(
      parseAuditEvent({
        ...event(),
        sourceKind: 'operator_command',
        sourceEventType: null,
        sourceEventVersion: null,
        sourceContext: null,
        sourceAggregateId: null,
      }),
    ).toMatchObject({ sourceKind: 'operator_command' })
  })

  it('refuses un-attributed system actors and invalid occurrence times', () => {
    expect(() => parseAuditEvent({ ...event(), actorType: 'system' })).toThrow(
      'Invalid audit actor attribution',
    )
    expect(() => parseAuditEvent({ ...event(), occurredAt: new Date(NaN) })).toThrow(
      ZodError,
    )
  })
})
