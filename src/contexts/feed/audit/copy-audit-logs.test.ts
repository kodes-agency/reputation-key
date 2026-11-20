import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import { auditEventFromLog, type AuditLogRecord } from './copy-audit-logs.server'

const AT = new Date('2026-11-01T10:00:00Z')
const log = (overrides: Partial<AuditLogRecord> = {}): AuditLogRecord => ({
  id: '8f1c2a52-5b0e-4f3c-9a0e-5f3a2a9c1b11',
  organizationId: 'org-1',
  userId: 'user-1',
  action: 'goal.program.revised',
  resourceType: 'goal_program',
  resourceId: 'program-1',
  details: { propertyId: 'property-1', metric: 'rating' },
  success: true,
  ipAddress: '203.0.113.9',
  createdAt: AT,
  updatedAt: AT,
  ...overrides,
})

describe('auditEventFromLog', () => {
  it('maps a goal row to an interactive command by a user, keeping time and Property', () => {
    expect(auditEventFromLog(log())).toEqual({
      organizationId: 'org-1',
      propertyId: 'property-1',
      actorType: 'user',
      actorId: 'user-1',
      action: 'goal.program.revised',
      outcome: 'succeeded',
      resourceType: 'goal_program',
      resourceId: 'program-1',
      sourceKind: 'interactive_command',
      sourceId: '8f1c2a52-5b0e-4f3c-9a0e-5f3a2a9c1b11',
      sourceEventType: null,
      sourceEventVersion: null,
      sourceContext: null,
      sourceAggregateId: null,
      occurredAt: AT,
    })
  })

  it('maps console actions to an operator command by an operator', () => {
    expect(
      auditEventFromLog(log({ action: 'platform.admin_invited', details: null })),
    ).toMatchObject({
      actorType: 'operator',
      sourceKind: 'operator_command',
      propertyId: null,
    })
  })

  it('maps the system user to a system actor without an id', () => {
    expect(auditEventFromLog(log({ userId: 'system' }))).toMatchObject({
      actorType: 'system',
      actorId: null,
    })
  })

  it('maps an ops actor to an operator and a failure to a failed outcome', () => {
    expect(auditEventFromLog(log({ userId: 'ops:ada', success: false }))).toMatchObject({
      actorType: 'operator',
      outcome: 'failed',
    })
  })

  it('refuses a row whose id the audit event shape rejects', () => {
    expect(() => auditEventFromLog(log({ resourceId: 'has a space' }))).toThrow(ZodError)
  })
})
