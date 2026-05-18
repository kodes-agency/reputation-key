import { TabsContent } from '#/components/ui/tabs'
import { Button } from '#/components/ui/button'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Plus, Trash2, Users } from 'lucide-react'
import { CreateTeamForm } from '#/components/features/team'
import { EmptyState } from '#/components/ui/empty-state'
import type { Action } from '#/components/hooks/use-action'
import type { MemberLike } from '#/lib/lookups'
import type { CreateTeamInput } from '#/contexts/team/application/dto/create-team.dto'
import { usePermissions } from '#/shared/hooks/usePermissions'

interface TeamsTabProps {
  propertyId: string
  teams: ReadonlyArray<{ id: string; name: string }>
  assignments: ReadonlyArray<{ id: string; userId: string; teamId: string | null }>
  memberOptions: MemberLike[]
  createTeamMutation: Action<{ data: CreateTeamInput }>
  deleteTeamMutation: Action<{ data: { teamId: string } }>
  createTeamOpen: boolean
  onCreateTeamOpenChange: (open: boolean) => void
}

export function TeamsTab({
  propertyId,
  teams,
  assignments,
  memberOptions,
  createTeamMutation,
  deleteTeamMutation,
  createTeamOpen,
  onCreateTeamOpenChange,
}: TeamsTabProps) {
  const { can } = usePermissions()

  return (
    <TabsContent value="teams" className="mt-4 space-y-4">
      <div className="flex justify-end">
        {can('team.create') && (
          <Dialog open={createTeamOpen} onOpenChange={onCreateTeamOpenChange}>
            <DialogTrigger asChild>
              <Button>
                <Plus />
                Create Team
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create a new team</DialogTitle>
                <DialogDescription>
                  Group staff members into teams for this property.
                </DialogDescription>
              </DialogHeader>
              <CreateTeamForm
                propertyId={propertyId}
                mutation={createTeamMutation}
                members={memberOptions}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>
      {teams.length === 0 ? (
        <EmptyState icon={Users} title="No teams yet">
          <p className="text-sm text-muted-foreground">
            Create a team to group staff members.
          </p>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {teams.map((team) => (
            <div
              key={team.id}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <div>
                <p className="font-semibold">{team.name}</p>
                <p className="text-sm text-muted-foreground">
                  {assignments.filter((a) => a.teamId === team.id).length} members
                </p>
              </div>
              {can('team.delete') && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {team.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will remove the team. You can recreate it later.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteTeamMutation({ data: { teamId: team.id } })}
                        disabled={deleteTeamMutation.isPending}
                        className="bg-destructive text-white hover:bg-destructive/90"
                      >
                        {deleteTeamMutation.isPending ? 'Deleting…' : 'Delete team'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          ))}
        </div>
      )}
    </TabsContent>
  )
}
