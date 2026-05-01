/**
 * TeamMemberList — table of team members with bulk add via dialog.
 * Shows assigned members in a table, with a dialog for adding multiple members at once.
 */

import { useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import type { MemberLike } from '#/lib/lookups'
import { buildMemberLookup, getAvailableMembers } from '#/lib/lookups'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { FormErrorBanner } from '#/components/forms/FormErrorBanner'
import { UserPlus } from 'lucide-react'

interface AssignmentInTeam {
  id: string
  userId: string
  teamId: string | null
}

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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">
            {assignments.length} {assignments.length === 1 ? 'member' : 'members'}
          </h2>
        </div>
        {available.length > 0 && (
          <Dialog open={addOpen} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <UserPlus />
                Add Members
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add team members</DialogTitle>
                <DialogDescription>
                  Select people from your organization to add to this team.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                {available.length > 1 && (
                  <div className="flex items-center gap-2 border-b pb-2">
                    <Checkbox
                      checked={selectedIds.size === available.length}
                      onCheckedChange={toggleAll}
                      aria-label="Select all"
                    />
                    <span className="text-sm text-muted-foreground">
                      {selectedIds.size === available.length
                        ? 'Deselect all'
                        : 'Select all'}
                    </span>
                  </div>
                )}
                <div className="max-h-[300px] space-y-1 overflow-y-auto">
                  {available.map((m) => (
                    <label
                      key={m.userId}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted"
                    >
                      <Checkbox
                        checked={selectedIds.has(m.userId)}
                        onCheckedChange={() => toggleMember(m.userId)}
                        aria-label={`Select ${m.name}`}
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{m.name}</div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </div>
                    </label>
                  ))}
                </div>
                <FormErrorBanner error={addAction.error} />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setAddOpen(false)}
                  disabled={adding}
                >
                  Cancel
                </Button>
                <Button onClick={handleAdd} disabled={selectedIds.size === 0 || adding}>
                  {adding
                    ? 'Adding...'
                    : `Add ${selectedIds.size || ''} member${selectedIds.size !== 1 ? 's' : ''}`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {assignments.length === 0 ? (
        <div className="rounded-lg border py-8 text-center">
          <p className="text-sm text-muted-foreground">No members in this team yet.</p>
          {available.length > 0 && (
            <Button variant="link" size="sm" onClick={() => setAddOpen(true)}>
              Add the first members
            </Button>
          )}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assignments.map((a) => {
              const member = memberLookup.get(a.userId)
              const isLead = teamLeadId != null && a.userId === teamLeadId
              return (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">
                    {member?.name ?? a.userId}
                    {isLead && (
                      <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                        Lead
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {member?.email ?? '\u2014'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        removeAction({
                          data: { assignmentId: a.id },
                        })
                      }
                      disabled={removeAction.isPending}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      {available.length === 0 && assignments.length > 0 && (
        <p className="text-sm text-muted-foreground">
          All organization members are already in this team.
        </p>
      )}
    </div>
  )
}
