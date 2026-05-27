import { describe, it, expect } from 'vitest'
import { buildStaffAssignment } from './constructors'
import {
  staffAssignmentId,
  organizationId,
  userId,
  propertyId,
  teamId,
  portalId,
} from '#/shared/domain/ids'

describe('buildStaffAssignment', () => {
  const base = {
    id: staffAssignmentId('sa-1'),
    organizationId: organizationId('org-1'),
    userId: userId('user-1'),
    propertyId: propertyId('prop-1'),
    now: new Date('2025-01-01'),
  }

  it('accepts portalId', () => {
    const result = buildStaffAssignment({
      ...base,
      portalId: portalId('portal-1'),
    })

    expect(result.isOk()).toBe(true)
    const assignment = result._unsafeUnwrap()
    expect(assignment.portalId).toBe(portalId('portal-1'))
  })

  it('defaults portalId to null when omitted', () => {
    const result = buildStaffAssignment(base)

    expect(result.isOk()).toBe(true)
    const assignment = result._unsafeUnwrap()
    expect(assignment.portalId).toBeNull()
  })

  it('preserves existing fields', () => {
    const result = buildStaffAssignment({
      ...base,
      teamId: teamId('team-1'),
      portalId: portalId('p-1'),
    })

    expect(result.isOk()).toBe(true)
    const a = result._unsafeUnwrap()
    expect(a.teamId).toBe(teamId('team-1'))
    expect(a.organizationId).toBe(organizationId('org-1'))
    expect(a.userId).toBe(userId('user-1'))
  })

  it('rejects self-assignment when actingUserId equals userId', () => {
    const result = buildStaffAssignment({
      ...base,
      actingUserId: userId('user-1'),
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_input')
      expect(result.error.message).toContain('Cannot assign yourself')
    }
  })

  it('allows assignment when actingUserId differs from userId', () => {
    const result = buildStaffAssignment({
      ...base,
      actingUserId: userId('user-2'),
    })

    expect(result.isOk()).toBe(true)
  })

  it('allows assignment when actingUserId is not provided', () => {
    const result = buildStaffAssignment(base)

    expect(result.isOk()).toBe(true)
  })
})
