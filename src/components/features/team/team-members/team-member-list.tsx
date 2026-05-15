/**
 * TeamMemberList — table of team members with bulk add via dialog.
 * Shows assigned members in a table, with a dialog for adding multiple members at once.
 */

import { useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import type { MemberLike } from '#/lib/lookups'
import { buildMemberLookup, getAvailableMembers } from '#/lib/lookups'
import { TeamEmptyState } from './team-empty-state'
import { TeamHeader } from './team-header'
import { MemberTable } from './member-table'
import type { AssignmentInTeam } from '#/components/features/team/shared/types'

type Props = Readonly<{
  teamId: string
  propertyId: string
  assignments: ReadonlyArray<AssignmentInTeam>
  members: ReadonlyArray<MemberLike>
  teamLeadId?: string | null
  addAction: Action<{
    data: { userId: string; propertyId: string; teamId: string }
  }>
  removeAction: Action<{ data: { assignmentId: string } }>
}>

export function TeamMemberList({
  teamId,
  propertyId,
  assignments,
  members,
  teamLeadId,
  addAction,
  removeAction,
}: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)

  const memberLookup = buildMemberLookup(members)
  const available = getAvailableMembers(members, assignments, teamId)

  const toggleMember = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }

  const toggleAll = () => {
    if (selectedIds.size === available.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(available.map((m) => m.userId)))
    }
  }

  const handleAdd = async () => {
    if (selectedIds.size === 0) return
    setAdding(true)
    const results = await Promise.allSettled(
      Array.from(selectedIds).map((userId) =>
        addAction({ data: { userId, propertyId, teamId } }),
      ),
    )
    setAdding(false)
    const failures = results.filter((r) => r.status === 'rejected')
    if (failures.length === 0) {
      setAddOpen(false)
      setSelectedIds(new Set())
    }
  }

  const handleOpenChange = (open: boolean) => {
    setAddOpen(open)
    if (!open) {
      setSelectedIds(new Set())
    }
  }

  return (
    <div className="space-y-4">
      <TeamHeader
        memberCount={assignments.length}
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

      {assignments.length === 0 ? (
        <TeamEmptyState
          hasAvailable={available.length > 0}
          onAdd={() => setAddOpen(true)}
        />
      ) : (
        <MemberTable
          assignments={assignments}
          memberLookup={memberLookup}
          teamLeadId={teamLeadId}
          onRemove={(assignmentId) => removeAction({ data: { assignmentId } })}
          isRemoving={removeAction.isPending}
        />
      )}

      {available.length === 0 && assignments.length > 0 && (
        <p className="text-sm text-muted-foreground">
          All organization members are already in this team.
        </p>
      )}
    </div>
  )
}
