// The staff goals read while the scan-target switch is off: the container is
// built with the setting, so this case lives in its own file.

import { expect, it, vi } from 'vitest'
import {
  GOAL_CLEANUP_TABLES,
  GOAL_CLEANUP_TRIGGERS,
} from '#/shared/testing/server-function-goal-seeds'
import { PORTAL_SEED_CLEANUP_TABLES } from '#/shared/testing/server-function-portal-seeds'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { getMyGoals } from './staff-self-results'

const NOW = new Date('2026-08-15T12:00:00.000Z')

const harness = setupServerFunctionHarness({
  clock: () => NOW,
  env: { STAFF_SCAN_TARGETS_ENABLED: 'false' },
  cleanupTables: [...GOAL_CLEANUP_TABLES, ...PORTAL_SEED_CLEANUP_TABLES],
  disabledTriggers: GOAL_CLEANUP_TRIGGERS,
})

it('answers no goals while scan targets are off, even for a person with a goal', async () => {
  const organization = await harness.seedOrganization()
  const member = await harness.seedMember(organization, 'Member')
  const property = await harness.seedProperty(organization)
  const staff = await harness.seedStaffParticipation(member, property)
  const group = await harness.seedPortalGroup(property, [staff.personalPortal!])
  await harness.seedGoalProgram(property, {
    subject: { kind: 'portal_group', groupId: group.id },
  })

  await expect(
    harness.callAs(member, () =>
      getMyGoals({ data: { participationId: staff.participationId } }),
    ),
  ).resolves.toEqual({ goals: [] })
})
