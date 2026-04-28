// Staff context — row ↔ domain mapper tests
// Verifies staffAssignmentFromRow and staffAssignmentToRow round-trip correctly,
// including nullable fields (teamId, deletedAt).

import { describe, it, expect } from 'vitest'
import { staffAssignmentFromRow, staffAssignmentToRow } from './staff-assignment.mapper'
import type { StaffAssignment } from '../../domain/types'
import {
  organizationId,
  propertyId,
  staffAssignmentId,
  teamId,
  userId,
} from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const makeStaffRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'assign-1',
  organizationId: 'org-1',
  userId: 'user-1',
  propertyId: 'prop-1',
  teamId: 'team-1',
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  deletedAt: null,
  ...overrides,
})

const makeStaffAssignment = (
  overrides: Partial<StaffAssignment> = {},
): StaffAssignment => ({
  id: staffAssignmentId('assign-1'),
  organizationId: organizationId('org-1'),
  userId: userId('user-1'),
  propertyId: propertyId('prop-1'),
  teamId: teamId('team-1'),
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  deletedAt: null,
  ...overrides,
})

describe('staffAssignmentFromRow', () => {
  it('maps all fields from row to domain', () => {
    // Arrange
    const row = makeStaffRow()

    // Act
    const assignment = staffAssignmentFromRow(row)

    // Assert
    expect(assignment.id).toBe('assign-1')
    expect(assignment.organizationId).toBe('org-1')
    expect(assignment.userId).toBe('user-1')
    expect(assignment.propertyId).toBe('prop-1')
    expect(assignment.teamId).toBe('team-1')
    expect(assignment.createdAt).toBe(FIXED_TIME)
    expect(assignment.updatedAt).toBe(FIXED_TIME)
    expect(assignment.deletedAt).toBeNull()
  })

  it('maps null teamId correctly', () => {
    // Arrange
    const row = makeStaffRow({ teamId: null })

    // Act
    const assignment = staffAssignmentFromRow(row)

    // Assert
    expect(assignment.teamId).toBeNull()
  })

  it('maps deletedAt date when present', () => {
    // Arrange
    const deletedAt = new Date('2026-05-01T00:00:00Z')
    const row = makeStaffRow({ deletedAt })

    // Act
    const assignment = staffAssignmentFromRow(row)

    // Assert
    expect(assignment.deletedAt).toEqual(deletedAt)
  })
})

describe('staffAssignmentToRow', () => {
  it('maps all fields from domain to row', () => {
    // Arrange
    const assignment = makeStaffAssignment()

    // Act
    const row = staffAssignmentToRow(assignment)

    // Assert
    expect(row.id).toBe('assign-1')
    expect(row.organizationId).toBe('org-1')
    expect(row.userId).toBe('user-1')
    expect(row.propertyId).toBe('prop-1')
    expect(row.teamId).toBe('team-1')
    expect(row.createdAt).toBe(FIXED_TIME)
    expect(row.updatedAt).toBe(FIXED_TIME)
    expect(row.deletedAt).toBeNull()
  })

  it('maps null teamId to row', () => {
    // Arrange
    const assignment = makeStaffAssignment({ teamId: null })

    // Act
    const row = staffAssignmentToRow(assignment)

    // Assert
    expect(row.teamId).toBeNull()
  })
})

describe('round-trip: staffAssignmentToRow → staffAssignmentFromRow', () => {
  it('preserves all fields through a round-trip', () => {
    // Arrange
    const original = makeStaffAssignment()

    // Act
    const row = staffAssignmentToRow(original)
    const restored = staffAssignmentFromRow(row as ReturnType<typeof makeStaffRow>)

    // Assert
    expect(restored.id).toBe(original.id)
    expect(restored.organizationId).toBe(original.organizationId)
    expect(restored.userId).toBe(original.userId)
    expect(restored.propertyId).toBe(original.propertyId)
    expect(restored.teamId).toBe(original.teamId)
    expect(restored.createdAt).toBe(original.createdAt)
    expect(restored.updatedAt).toBe(original.updatedAt)
    expect(restored.deletedAt).toBe(original.deletedAt)
  })

  it('preserves null teamId through a round-trip', () => {
    // Arrange
    const original = makeStaffAssignment({ teamId: null })

    // Act
    const row = staffAssignmentToRow(original)
    const restored = staffAssignmentFromRow(row as ReturnType<typeof makeStaffRow>)

    // Assert
    expect(restored.teamId).toBeNull()
  })

  it('preserves deletedAt through a round-trip', () => {
    // Arrange
    const deletedAt = new Date('2026-05-01T00:00:00Z')
    const original = makeStaffAssignment({ deletedAt })

    // Act
    const row = staffAssignmentToRow(original)
    const restored = staffAssignmentFromRow(row as ReturnType<typeof makeStaffRow>)

    // Assert
    expect(restored.deletedAt).toEqual(deletedAt)
  })
})
