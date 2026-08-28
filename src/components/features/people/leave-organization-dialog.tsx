// LIF-01-T21 — transfer-first leave.
//
// The dialog is built around one rule: you cannot leave until every
// responsibility you hold has a named successor. There is deliberately no
// "leave anyway", no "release to nobody" and no auto-assign — picking who
// becomes accountable for a Portal, a Property or an open Inbox item is a
// decision a person has to make, and stranding one is a compliance gap rather
// than an inbox item somebody will notice later.
//
// The sole AccountAdmin case is refused by the server; this surface explains
// it up front instead of letting someone fill in a whole transfer form first.

import { useState } from 'react'
import { LogOut, TriangleAlert } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { AnyAction } from '#/components/hooks/use-action'
import type {
  OffboardingResponsibilityKind,
  OutstandingResponsibility,
} from '#/contexts/identity/application/ports/member-offboarding.port'

const KIND_LABEL: Readonly<Record<OffboardingResponsibilityKind, string>> = {
  portal_responsibility: 'Portal responsibility',
  property_responsibility: 'Property responsibility',
  inbox_assignment: 'Open inbox item',
}

export type LeaveCandidate = Readonly<{ userId: string; name: string }>

export type LeaveOrganizationDialogProps = Readonly<{
  outstanding: readonly OutstandingResponsibility[]
  /** Eligible current managers who may receive a responsibility. */
  candidates: readonly LeaveCandidate[]
  /** True when the caller is the only AccountAdmin left. */
  isSoleAccountAdmin: boolean
  leaveOrganization: AnyAction
}>

const keyOf = (item: OutstandingResponsibility): string =>
  `${item.kind}:${item.resourceId}`

export function LeaveOrganizationDialog({
  outstanding,
  candidates,
  isSoleAccountAdmin,
  leaveOrganization,
}: LeaveOrganizationDialogProps) {
  const [assignments, setAssignments] = useState<ReadonlyMap<string, string>>(new Map())

  const assign = (key: string, toUserId: string) => {
    // Immutable: a new Map per change, never a mutation of the held one.
    const updated = new Map(assignments)
    updated.set(key, toUserId)
    setAssignments(updated)
  }

  const unassigned = outstanding.filter((item) => !assignments.has(keyOf(item)))
  const canLeave = !isSoleAccountAdmin && unassigned.length === 0 && candidates.length > 0

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="open-leave-organization">
          <LogOut aria-hidden="true" />
          Leave organization
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="leave-organization-dialog">
        <DialogHeader>
          <DialogTitle>Leave this organization</DialogTitle>
          <DialogDescription>
            Your access ends immediately and every one of your sessions is signed out.
            Hand over what you are responsible for first.
          </DialogDescription>
        </DialogHeader>

        {isSoleAccountAdmin ? (
          <Alert variant="destructive" data-testid="sole-account-admin-block">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>You are the only account administrator</AlertTitle>
            <AlertDescription>
              Promote another person to account administrator first. Leaving now would
              produce an organization nobody can administer — including nobody who could
              close it.
            </AlertDescription>
          </Alert>
        ) : outstanding.length === 0 ? (
          <p className="text-sm" data-testid="leave-no-outstanding">
            You hold no portal responsibilities, property responsibilities or open inbox
            assignments.
          </p>
        ) : (
          <div className="space-y-4" data-testid="leave-transfer-list">
            <p className="text-muted-foreground text-sm">
              Choose who takes over each item. Nothing is released to nobody.
            </p>
            {outstanding.map((item) => {
              const key = keyOf(item)
              return (
                <div key={key} className="grid gap-1.5" data-testid={`transfer-${key}`}>
                  <Label htmlFor={`transfer-${key}`}>
                    {KIND_LABEL[item.kind]}
                    <span className="text-muted-foreground ml-2 font-mono text-xs">
                      {item.resourceId}
                    </span>
                  </Label>
                  <Select
                    value={assignments.get(key) ?? ''}
                    onValueChange={(next) => assign(key, next)}
                  >
                    <SelectTrigger id={`transfer-${key}`}>
                      <SelectValue placeholder="Choose a manager" />
                    </SelectTrigger>
                    <SelectContent>
                      {candidates.map((candidate) => (
                        <SelectItem key={candidate.userId} value={candidate.userId}>
                          {candidate.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )
            })}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="destructive"
            disabled={!canLeave || leaveOrganization.isPending}
            data-testid="confirm-leave-organization"
            onClick={() =>
              void leaveOrganization({
                data: {
                  transfers: outstanding.map((item) => ({
                    kind: item.kind,
                    resourceId: item.resourceId,
                    toUserId: assignments.get(keyOf(item))!,
                  })),
                },
              })
            }
          >
            Transfer and leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
