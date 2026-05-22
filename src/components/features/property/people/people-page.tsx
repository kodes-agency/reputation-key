// People page component — staff, teams, and directory management
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import {
  listStaffAssignments,
  createStaffAssignment,
  removeStaffAssignment,
} from '#/contexts/staff/server/staff-assignments'
import { listTeams, createTeam, deleteTeam } from '#/contexts/team/server/teams'
import { listMembers } from '#/contexts/identity/server/organizations'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import {
  useMutationAction,
  useMutationActionSilent,
} from '#/components/hooks/use-mutation-action'
import { toMemberOptions, toTeamOptions } from '#/lib/lookups'
import { StaffTab } from '#/components/features/property/people/staff-tab'
import { TeamsTab } from '#/components/features/property/people/teams-tab'
import { DirectoryTab } from '#/components/features/property/people/directory-tab'

export const peopleSearchSchema = z.object({
  tab: z.string().optional(),
})

interface PeoplePageProps {
  propertyId: string
  assignments: Awaited<ReturnType<typeof listStaffAssignments>>['assignments']
  members: Awaited<ReturnType<typeof listMembers>>['members']
  teams: Awaited<ReturnType<typeof listTeams>>['teams']
  tab: string | undefined
}

export function PeoplePage({ propertyId, assignments, members, teams, tab }: PeoplePageProps) {
  const defaultTab = tab ?? 'staff'
  const [assignOpen, setAssignOpen] = useState(false)
  const [createTeamOpen, setCreateTeamOpen] = useState(false)
  const navigate = useNavigate()

  const memberOptions = toMemberOptions(members)
  const teamOptions = toTeamOptions(teams)
  const assignedUserIds = new Set(assignments.map((a) => a.userId))

  const invalidateRoutes = [
    '/_authenticated/properties/$propertyId/people',
    '/_authenticated/properties/$propertyId',
  ] as const

  const assignMutation = useMutationActionSilent(createStaffAssignment, {
    invalidateRoutes: [...invalidateRoutes],
  })
  const removeMutation = useMutationAction(removeStaffAssignment, {
    successMessage: 'Staff member unassigned',
    invalidateRoutes: [...invalidateRoutes],
  })
  const createTeamMutation = useMutationAction(createTeam, {
    successMessage: 'Team created',
    invalidateRoutes: [...invalidateRoutes],
    onSuccess: async () => {
      setCreateTeamOpen(false)
    },
  })
  const deleteTeamMutation = useMutationAction(deleteTeam, {
    successMessage: 'Team deleted',
    invalidateRoutes: [...invalidateRoutes],
  })

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">People</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage staff assignments, team members, and organization directory.
        </p>
      </div>

      <Tabs
        value={defaultTab}
        onValueChange={(t) => navigate({ to: '.', search: { tab: t } })}
      >
        <TabsList>
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="directory">Directory</TabsTrigger>
        </TabsList>

        <StaffTab
          propertyId={propertyId}
          assignments={assignments}
          memberOptions={memberOptions}
          teamOptions={teamOptions}
          assignedUserIds={assignedUserIds}
          assignMutation={assignMutation}
          removeMutation={removeMutation}
          assignOpen={assignOpen}
          onAssignOpenChange={setAssignOpen}
        />
        <TeamsTab
          propertyId={propertyId}
          teams={teams}
          assignments={assignments}
          memberOptions={memberOptions}
          createTeamMutation={createTeamMutation}
          deleteTeamMutation={deleteTeamMutation}
          createTeamOpen={createTeamOpen}
          onCreateTeamOpenChange={setCreateTeamOpen}
        />
        <DirectoryTab members={members} />
      </Tabs>
    </div>
  )
}
