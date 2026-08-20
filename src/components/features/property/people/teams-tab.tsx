import { Link } from '@tanstack/react-router'
import { Archive, LockKeyhole, Plus, Users } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
import { CreateTeamForm } from '#/components/features/team'
import type {
  CreateTeamMutationInput,
  TeamMembershipView,
  TeamSummary,
} from '#/components/features/team/shared/types'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { EmptyState } from '#/components/ui/empty-state'
import { TabsContent } from '#/components/ui/tabs'

interface TeamsTabProps {
  propertyId: string
  teams: ReadonlyArray<TeamSummary>
  memberships: ReadonlyArray<TeamMembershipView>
  createTeamMutation: Action<{ data: CreateTeamMutationInput }>
  archiveTeamMutation: Action<{ data: { teamId: string } }>
  createTeamOpen: boolean
  onCreateTeamOpenChange: (open: boolean) => void
}

export function TeamsTab({
  propertyId,
  teams,
  memberships,
  createTeamMutation,
  archiveTeamMutation,
  createTeamOpen,
  onCreateTeamOpenChange,
}: TeamsTabProps) {
  const { can } = usePermissions()

  if (!can('team.read')) {
    return (
      <TabsContent value="teams" className="mt-4">
        <Alert>
          <LockKeyhole aria-hidden="true" />
          <AlertTitle>Team management is unavailable</AlertTitle>
          <AlertDescription>
            You do not have permission to view teams at this property.
          </AlertDescription>
        </Alert>
      </TabsContent>
    )
  }

  return (
    <TabsContent value="teams" className="mt-4 space-y-4">
      <div className="flex justify-end">
        {can('team.create') && (
          <Dialog open={createTeamOpen} onOpenChange={onCreateTeamOpenChange}>
            <DialogTrigger asChild>
              <Button>
                <Plus aria-hidden="true" />
                Create team
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create a new team</DialogTitle>
                <DialogDescription>
                  Create the team first, then add active staff and appoint its lead.
                </DialogDescription>
              </DialogHeader>
              <CreateTeamForm
                propertyId={propertyId}
                mutation={createTeamMutation}
                onSuccess={() => onCreateTeamOpenChange(false)}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {teams.length === 0 ? (
        <EmptyState icon={Users} title="No teams at this property">
          <p className="max-w-md text-sm text-muted-foreground">
            {can('team.create')
              ? 'Create a team, then add active staff and appoint a lead.'
              : 'A property manager can create the first team.'}
          </p>
        </EmptyState>
      ) : (
        <div className="divide-y rounded-lg border">
          {teams.map((team) => {
            const memberCount = memberships.filter(
              (membership) =>
                membership.teamId === team.id && membership.effectiveTo == null,
            ).length
            return (
              <div
                key={team.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <Link
                    to="/properties/$propertyId/teams/$teamId"
                    params={{ propertyId, teamId: team.id }}
                    className="font-semibold text-link underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {team.name}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {memberCount} {memberCount === 1 ? 'member' : 'members'}
                  </p>
                </div>
                {can('team.delete') && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Archive team ${team.name}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Archive aria-hidden="true" />
                        <span className="hidden sm:inline">Archive</span>
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Archive {team.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The team will no longer accept membership changes. Its effective
                          membership history remains available.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            archiveTeamMutation({ data: { teamId: team.id } })
                          }
                          disabled={archiveTeamMutation.isPending}
                        >
                          {archiveTeamMutation.isPending ? 'Archiving…' : 'Archive team'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            )
          })}
        </div>
      )}
    </TabsContent>
  )
}
