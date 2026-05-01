// Team context — list teams use case tests
// Verifies that listTeams filters by property access:
// AccountAdmin sees all, PropertyManager/Staff see only assigned properties.

import { describe, it, expect } from 'vitest'
import { listTeams } from './list-teams'
import { createInMemoryTeamRepo } from '#/shared/testing/in-memory-team-repo'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { organizationId, propertyId, teamId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Team } from '../../domain/types'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

// Must match buildTestAuthContext's default orgId so repo filters work.
const TEST_ORG_ID = 'org-00000000-0000-0000-0000-000000000001'

const makeTeam = (
  overrides: { id: string; propertyId: string } & Partial<
    Omit<Team, 'id' | 'propertyId'>
  >,
): Team => ({
  organizationId: organizationId(TEST_ORG_ID),
  name: `Team ${overrides.id}`,
  description: null,
  teamLeadId: null,
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  deletedAt: null,
  ...overrides,
  id: teamId(overrides.id),
  propertyId: propertyId(overrides.propertyId),
})

/** Create a StaffPublicApi fake. null = admin (all access), array = specific property IDs. */
const createFakeStaffApi = (
  responses: Map<string, ReadonlyArray<string> | null>,
): StaffPublicApi =>
  ({
    getAccessiblePropertyIds: async (
      _orgId: AuthContext['organizationId'],
      _uid: AuthContext['userId'],
      role: AuthContext['role'],
    ) => {
      return responses.get(role) ?? null
    },
  }) as StaffPublicApi

const setup = () => {
  const teamRepo = createInMemoryTeamRepo()
  const responses = new Map<string, ReadonlyArray<string> | null>()
  const staffApi = createFakeStaffApi(responses)
  const useCase = listTeams({ teamRepo, staffApi })
  return { teamRepo, staffApi, responses, useCase }
}

describe('listTeams', () => {
  it('returns all teams in a property for AccountAdmin', async () => {
    // Arrange
    const { teamRepo, responses, useCase } = setup()
    teamRepo.seed([
      makeTeam({ id: 't-1', propertyId: 'prop-1' }),
      makeTeam({ id: 't-2', propertyId: 'prop-1' }),
      makeTeam({ id: 't-3', propertyId: 'prop-2' }),
    ])
    responses.set('AccountAdmin', null) // null = admin access

    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    // Act
    const result = await useCase({ propertyId: propertyId('prop-1') }, ctx)

    // Assert
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.id as string)).toEqual(['t-1', 't-2'])
  })

  it('returns teams only for accessible property when PropertyManager has access', async () => {
    // Arrange
    const { teamRepo, responses, useCase } = setup()
    teamRepo.seed([
      makeTeam({ id: 't-1', propertyId: 'prop-1' }),
      makeTeam({ id: 't-2', propertyId: 'prop-2' }),
    ])
    responses.set('PropertyManager', [propertyId('prop-1')])

    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    // Act
    const result = await useCase({ propertyId: propertyId('prop-1') }, ctx)

    // Assert
    expect(result).toHaveLength(1)
    expect(result[0].id as string).toBe('t-1')
  })

  it('returns empty array when property is not accessible', async () => {
    // Arrange
    const { teamRepo, responses, useCase } = setup()
    teamRepo.seed([makeTeam({ id: 't-1', propertyId: 'prop-1' })])
    responses.set('PropertyManager', [propertyId('prop-other')])

    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    // Act
    const result = await useCase({ propertyId: propertyId('prop-1') }, ctx)

    // Assert
    expect(result).toEqual([])
  })

  it('returns empty array when no teams exist for the property', async () => {
    // Arrange
    const { responses, useCase } = setup()
    responses.set('AccountAdmin', null)

    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    // Act
    const result = await useCase({ propertyId: propertyId('prop-empty') }, ctx)

    // Assert
    expect(result).toEqual([])
  })

  it('returns empty array for Staff with no accessible properties', async () => {
    // Arrange
    const { teamRepo, responses, useCase } = setup()
    teamRepo.seed([makeTeam({ id: 't-1', propertyId: 'prop-1' })])
    responses.set('Staff', [])

    const ctx = buildTestAuthContext({ role: 'Staff' })

    // Act
    const result = await useCase({ propertyId: propertyId('prop-1') }, ctx)

    // Assert
    expect(result).toEqual([])
  })

  it('returns teams when PropertyManager has access to multiple properties', async () => {
    // Arrange
    const { teamRepo, responses, useCase } = setup()
    teamRepo.seed([
      makeTeam({ id: 't-1', propertyId: 'prop-1' }),
      makeTeam({ id: 't-2', propertyId: 'prop-2' }),
      makeTeam({ id: 't-3', propertyId: 'prop-3' }),
    ])
    responses.set('PropertyManager', [propertyId('prop-1'), propertyId('prop-2')])

    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    // Act
    const result = await useCase({ propertyId: propertyId('prop-2') }, ctx)

    // Assert
    expect(result).toHaveLength(1)
    expect(result[0].id as string).toBe('t-2')
  })
})
