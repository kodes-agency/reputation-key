import { useMemo, useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { TeamEmptyState } from './team-empty-state'
import { TeamHeader } from './team-header'
import { MemberTable } from './member-table'
import type {
  StaffParticipationView,
  TeamMembershipView,
} from '#/components/features/team/shared/types'

type Props = Readonly<{
  teamId: string
  memberships: ReadonlyArray<TeamMembershipView>
  availableParticipations: ReadonlyArray<
    Pick<StaffParticipationView, 'id' | 'userId' | 'displayName'>
  >
  canManageMembers: boolean
  addAction: Action<{
    data: { teamId: string; staffParticipationId: string }
  }>
  removeAction: Action<{
    data: { teamId: string; staffParticipationId: string; reason?: string }
  }>
}>

export function TeamMemberList({
  teamId,
  memberships,
  availableParticipations,
  canManageMembers,
  addAction,
  removeAction,
}: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const activeMemberships = useMemo(
    () => memberships.filter((membership) => membership.effectiveTo == null),
    [memberships],
  )
  const membershipHistory = useMemo(
    () => memberships.filter((membership) => membership.effectiveTo != null),
    [memberships],
  )
  const activeMembershipIds = useMemo(
    () => new Set(activeMemberships.map((membership) => membership.staffParticipationId)),
    [activeMemberships],
  )
  const available = useMemo(
    () =>
      canManageMembers
        ? availableParticipations.filter(
            (participation) => !activeMembershipIds.has(participation.id),
          )
        : [],
    [activeMembershipIds, availableParticipations, canManageMembers],
  )

  const toggleMember = (staffParticipationId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(staffParticipationId)) next.delete(staffParticipationId)
      else next.add(staffParticipationId)
      return next
    })
  }

  const toggleAll = () => {
    setSelectedIds((previous) =>
      previous.size === available.length
        ? new Set()
        : new Set(available.map((participation) => participation.id)),
    )
  }

  const handleAdd = async () => {
    if (selectedIds.size === 0) return
    setAdding(true)
    const selected = Array.from(selectedIds)
    const results = await Promise.allSettled(
      selected.map((staffParticipationId) =>
        addAction({ data: { teamId, staffParticipationId } }),
      ),
    )
    setAdding(false)
    const failedIds = selected.filter((_, index) => results[index].status === 'rejected')
    if (failedIds.length === 0) setAddOpen(false)
    setSelectedIds(new Set(failedIds))
  }

  const handleOpenChange = (open: boolean) => {
    setAddOpen(open)
    if (!open) setSelectedIds(new Set())
  }

  return (
    <section className="space-y-4" aria-labelledby="team-members-heading">
      <TeamHeader
        memberCount={activeMemberships.length}
        availableCount={available.length}
        addDialog={{
          isOpen: addOpen,
          available,
          selectedIds,
          error: addAction.error,
          isAdding: adding,
          onOpenChange: handleOpenChange,
          onToggleMember: toggleMember,
          onToggleAll: toggleAll,
          onAdd: handleAdd,
        }}
      />

      {activeMemberships.length === 0 ? (
        <TeamEmptyState
          canManage={canManageMembers}
          hasAvailable={available.length > 0}
          onAdd={() => setAddOpen(true)}
        />
      ) : (
        <MemberTable
          memberships={activeMemberships}
          canRemove={canManageMembers}
          onRemove={(staffParticipationId) =>
            removeAction({
              data: {
                teamId,
                staffParticipationId,
                reason: 'Removed from team membership list',
              },
            })
          }
          isRemoving={removeAction.isPending}
        />
      )}

      {membershipHistory.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Membership history</h3>
          <MemberTable
            memberships={membershipHistory}
            canRemove={false}
            isRemoving={false}
          />
        </div>
      )}

      <FormErrorBanner error={removeAction.error} />

      {canManageMembers && available.length === 0 && activeMemberships.length > 0 && (
        <p className="text-sm text-muted-foreground" role="status">
          Every eligible staff participant is already on this team.
        </p>
      )}
    </section>
  )
}
