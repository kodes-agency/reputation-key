// Team context — row ↔ domain mapper tests
// Verifies teamFromRow and teamToRow round-trip correctly,
// including nullable fields (description, teamLeadId, deletedAt).

import { describe, it, expect } from 'vitest'
import { teamFromRow, teamToRow } from './team.mapper'
import type { Team } from '../../domain/types'
import { organizationId, propertyId, teamId, userId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const makeTeamRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'team-1',
  organizationId: 'org-1',
  propertyId: 'prop-1',
  name: 'Alpha Team',
  description: 'The first team',
  teamLeadId: 'user-1',
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  deletedAt: null,
  ...overrides,
})

const makeTeam = (overrides: Partial<Team> = {}): Team => ({
  id: teamId('team-1'),
  organizationId: organizationId('org-1'),
  propertyId: propertyId('prop-1'),
  name: 'Alpha Team',
  description: 'The first team',
  teamLeadId: userId('user-1'),
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  deletedAt: null,
  ...overrides,
})

describe('teamFromRow', () => {
  it('maps all fields from row to domain', () => {
    // Arrange
    const row = makeTeamRow()

    // Act
    const team = teamFromRow(row)

    // Assert
    expect(team.id).toBe('team-1')
    expect(team.organizationId).toBe('org-1')
    expect(team.propertyId).toBe('prop-1')
    expect(team.name).toBe('Alpha Team')
    expect(team.description).toBe('The first team')
    expect(team.teamLeadId).toBe('user-1')
    expect(team.createdAt).toBe(FIXED_TIME)
    expect(team.updatedAt).toBe(FIXED_TIME)
    expect(team.deletedAt).toBeNull()
  })

  it('maps null description correctly', () => {
    // Arrange
    const row = makeTeamRow({ description: null })

    // Act
    const team = teamFromRow(row)

    // Assert
    expect(team.description).toBeNull()
  })

  it('maps null teamLeadId correctly', () => {
    // Arrange
    const row = makeTeamRow({ teamLeadId: null })

    // Act
    const team = teamFromRow(row)

    // Assert
    expect(team.teamLeadId).toBeNull()
  })

  it('maps deletedAt date when present', () => {
    // Arrange
    const deletedAt = new Date('2026-05-01T00:00:00Z')
    const row = makeTeamRow({ deletedAt })

    // Act
    const team = teamFromRow(row)

    // Assert
    expect(team.deletedAt).toEqual(deletedAt)
  })
})

describe('teamToRow', () => {
  it('maps all fields from domain to row', () => {
    // Arrange
    const team = makeTeam()

    // Act
    const row = teamToRow(team)

    // Assert
    expect(row.id).toBe('team-1')
    expect(row.organizationId).toBe('org-1')
    expect(row.propertyId).toBe('prop-1')
    expect(row.name).toBe('Alpha Team')
    expect(row.description).toBe('The first team')
    expect(row.teamLeadId).toBe('user-1')
    expect(row.createdAt).toBe(FIXED_TIME)
    expect(row.updatedAt).toBe(FIXED_TIME)
    expect(row.deletedAt).toBeNull()
  })

  it('maps null teamLeadId to row', () => {
    // Arrange
    const team = makeTeam({ teamLeadId: null })

    // Act
    const row = teamToRow(team)

    // Assert
    expect(row.teamLeadId).toBeNull()
  })

  it('maps null description to row', () => {
    // Arrange
    const team = makeTeam({ description: null })

    // Act
    const row = teamToRow(team)

    // Assert
    expect(row.description).toBeNull()
  })
})

describe('round-trip: teamToRow → teamFromRow', () => {
  it('preserves all fields through a round-trip', () => {
    // Arrange
    const original = makeTeam()

    // Act
    const row = teamToRow(original)
    const restored = teamFromRow(row as ReturnType<typeof makeTeamRow>)

    // Assert
    expect(restored.id).toBe(original.id)
    expect(restored.organizationId).toBe(original.organizationId)
    expect(restored.propertyId).toBe(original.propertyId)
    expect(restored.name).toBe(original.name)
    expect(restored.description).toBe(original.description)
    expect(restored.teamLeadId).toBe(original.teamLeadId)
    expect(restored.createdAt).toBe(original.createdAt)
    expect(restored.updatedAt).toBe(original.updatedAt)
    expect(restored.deletedAt).toBe(original.deletedAt)
  })

  it('preserves null fields through a round-trip', () => {
    // Arrange
    const original = makeTeam({ description: null, teamLeadId: null, deletedAt: null })

    // Act
    const row = teamToRow(original)
    const restored = teamFromRow(row as ReturnType<typeof makeTeamRow>)

    // Assert
    expect(restored.description).toBeNull()
    expect(restored.teamLeadId).toBeNull()
    expect(restored.deletedAt).toBeNull()
  })
})
