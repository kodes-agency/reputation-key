// People page component — staff, teams, and directory management
import { useState } from 'react'
import { z } from 'zod'
import type { listStaffAssignments } from '#/contexts/staff/server/staff-assignments'
import type { listTeams } from '#/contexts/team/server/teams'
import type { listMembers } from '#/contexts/identity/server/organizations'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { toMemberOptions, toTeamOptions } from '#/lib/lookups'
import { StaffTab } from '#/components/features/property/people/staff-tab'
import { TeamsTab } from '#/components/features/property/people/teams-tab'
import { DirectoryTab } from '#/components/features/property/people/directory-tab'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import type { listPortals } from '#/contexts/portal/server/portals'
import type { Action } from '#/components/hooks/use-action'
import type { CreateStaffAssignmentInput } from '#/contexts/staff/application/dto/staff-assignment.dto'
import type { CreateTeamInput } from '#/contexts/team/application/dto/create-team.dto'

export const peopleSearchSchema = z.object({
  tab: z.string().optional(),
})

interface PeoplePageProps {
  propertyId: string
  propertyName: string
  assignments: Awaited<ReturnType<typeof listStaffAssignments>>['assignments']
  members: Awaited<ReturnType<typeof listMembers>>['members']
  teams: Awaited<ReturnType<typeof listTeams>>['teams']
  portals: Awaited<ReturnType<typeof listPortals>>['portals']
  tab: string | undefined
  onTabChange: (tab: string) => void
  assignMutation: Action<{ data: CreateStaffAssignmentInput }>
  removeMutation: Action<{ data: { assignmentId: string } }>
  createTeamMutation: Action<{ data: CreateTeamInput }>
  deleteTeamMutation: Action<{ data: { teamId: string } }>
  updatePortalsMutation: Action<{
    data: { userId: string; propertyId: string; portalIds: string[] }
  }>
}

export function PeoplePage({
  propertyId,
  propertyName,
  assignments,
  members,
  teams,
  portals,
  tab,
  onTabChange,
  assignMutation,
  removeMutation,
  createTeamMutation,
  deleteTeamMutation,
  updatePortalsMutation,
}: PeoplePageProps) {
  const defaultTab = tab ?? 'staff'
  const [assignOpen, setAssignOpen] = useState(false)
  const [createTeamOpen, setCreateTeamOpen] = useState(false)

  const memberOptions = toMemberOptions(members)
  const teamOptions = toTeamOptions(teams)
  const portalOptions = portals.map((p) => ({ id: String(p.id), name: p.name }))
  const assignedUserIds = new Set(assignments.map((a) => a.userId))

  return (
    <PageShell>
      <PageHeader
        title="People"
        description="Manage staff assignments, team members, and organization directory."
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propertyName, to: `/properties/${propertyId}` },
          { label: 'People' },
        ]}
      />

      <Tabs value={defaultTab} onValueChange={(t) => onTabChange(t)}>
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
          portalOptions={portalOptions}
          assignedUserIds={assignedUserIds}
          assignMutation={assignMutation}
          removeMutation={removeMutation}
          assignOpen={assignOpen}
          onAssignOpenChange={setAssignOpen}
          updatePortalsMutation={updatePortalsMutation}
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
    </PageShell>
  )
}
