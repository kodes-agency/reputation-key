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

  it('accepts portalId and referralCode', () => {
    const result = buildStaffAssignment({
      ...base,
      portalId: portalId('portal-1'),
      referralCode: 'jane-d-a3f2',
    })

    expect(result.isOk()).toBe(true)
    const assignment = result._unsafeUnwrap()
    expect(assignment.portalId).toBe(portalId('portal-1'))
    expect(assignment.referralCode).toBe('jane-d-a3f2')
  })

  it('defaults portalId and referralCode to null when omitted', () => {
    const result = buildStaffAssignment(base)

    expect(result.isOk()).toBe(true)
    const assignment = result._unsafeUnwrap()
    expect(assignment.portalId).toBeNull()
    expect(assignment.referralCode).toBeNull()
  })

  it('preserves existing fields', () => {
    const result = buildStaffAssignment({
      ...base,
      teamId: teamId('team-1'),
      portalId: portalId('p-1'),
      referralCode: 'john-s-b2c4',
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
