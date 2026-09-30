// Manage access: one sheet per Property Manager to choose which properties they
// can work and which of them they are responsible for, with a plain summary of
// the change above Save. Controlled by the route, which owns loading the
// member's current access and responsibility and saving the change.
//
// The body mounts per open (and once responsibility has loaded), so its drafts
// start from what the server holds each time and later refreshes do not
// overwrite an edit in progress.

import { useState } from 'react'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '#/components/ui/sheet'
import { RoleBadge } from '#/components/features/identity/shared/role-badge'
import { roleDescription } from '#/components/features/identity/shared/role-utils'
import type { Action } from '#/components/hooks/use-action'
import type { Role } from '#/shared/domain/roles'
import { diffMemberAccess, summarizeAccessChange } from './member-access-diff'
import { MemberAccessPropertyList } from './member-access-property-list'
import { RemoveMemberDialog } from './remove-member-dialog'
import type { PropertyRef } from './member-table'

export type MemberAccessTarget = Readonly<{
  id: string
  userId: string
  name: string
  email: string
  role: Role | null
}>

/** The Properties the member is a Responsible manager of, as the route read them. */
export type ResponsibilityState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'unavailable' }>
  | Readonly<{ status: 'ready'; responsibleIds: ReadonlyArray<string> }>

export type SaveMemberAccessInput = Readonly<{
  memberId: string
  userId: string
  grantPropertyIds: ReadonlyArray<string>
  revokePropertyIds: ReadonlyArray<string>
  responsibleOnPropertyIds: ReadonlyArray<string>
  responsibleOffPropertyIds: ReadonlyArray<string>
}>

type Props = Readonly<{
  /** The manager being edited; null keeps the sheet closed. */
  member: MemberAccessTarget | null
  onClose: () => void
  properties: ReadonlyArray<PropertyRef>
  /** The member's active grants, as the route read them. */
  currentPropertyIds: ReadonlyArray<string>
  responsibility: ResponsibilityState
  canRemove: boolean
  saveAction: Action<SaveMemberAccessInput>
  /** Reports its own outcome (toast); a refusal still rejects the call. */
  removeMemberAction: Action<{ data: { memberId: string } }>
}>

/** How the sheet addresses the member: their first name, else their address. */
function firstName(member: MemberAccessTarget): string {
  return member.name.trim().split(/\s+/)[0] || member.email
}

function AccessForm({
  member,
  onClose,
  properties,
  currentPropertyIds,
  responsibility,
  canRemove,
  saveAction,
  removeMemberAction,
}: Props & Readonly<{ member: MemberAccessTarget }>) {
  // Only properties the checklist lists can change; a grant on one that no
  // longer lists (archived) is left exactly as it is.
  const listed = new Set(properties.map((property) => property.id))
  const initialPropertyIds = currentPropertyIds.filter((id) => listed.has(id))
  const initialResponsibleIds =
    responsibility.status === 'ready' ? responsibility.responsibleIds : []
  const showResponsibility = responsibility.status === 'ready'

  const [selectedIds, setSelectedIds] = useState<string[]>(initialPropertyIds)
  const [responsibleIds, setResponsibleIds] = useState<string[]>([
    ...initialResponsibleIds,
  ])

  const change = diffMemberAccess(
    { propertyIds: initialPropertyIds, responsibleIds: initialResponsibleIds },
    { propertyIds: selectedIds, responsibleIds },
  )
  const nameOf = (id: string) => properties.find((p) => p.id === id)?.name ?? id
  const lines = summarizeAccessChange(change, nameOf, firstName(member))

  const save = () => {
    if (change.isEmpty) return
    void saveAction({
      memberId: member.id,
      userId: member.userId,
      grantPropertyIds: change.grantPropertyIds,
      revokePropertyIds: change.revokePropertyIds,
      responsibleOnPropertyIds: change.responsibleOnPropertyIds,
      responsibleOffPropertyIds: change.responsibleOffPropertyIds,
    }).catch(() => undefined)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4">
        <section className="flex flex-col gap-1.5" aria-label="Role">
          <div className="flex items-center gap-2">
            <RoleBadge role={member.role} rawRole="" />
          </div>
          <p className="text-sm text-muted-foreground">
            {roleDescription('PropertyManager')}
          </p>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="member-access-heading">
          <h3 id="member-access-heading" className="text-sm font-semibold">
            Properties · {selectedIds.length} of {properties.length}
          </h3>
          <MemberAccessPropertyList
            properties={properties}
            selectedIds={selectedIds}
            responsibleIds={responsibleIds}
            showResponsibility={showResponsibility}
            disabled={saveAction.isPending}
            onSelectedChange={setSelectedIds}
            onResponsibleChange={setResponsibleIds}
          />
          {responsibility.status === 'unavailable' ? (
            <p className="text-xs text-muted-foreground">
              Responsible managers could not be loaded. Set them from each property's
              Responsible managers settings.
            </p>
          ) : null}
        </section>

        <div
          role="status"
          className="flex flex-col gap-1 rounded-md bg-muted/50 p-3 text-sm"
        >
          {lines.length > 0 ? (
            lines.map((line) => <p key={line}>{line}</p>)
          ) : (
            <p className="text-muted-foreground">No changes yet.</p>
          )}
        </div>

        <FormErrorBanner error={saveAction.error} />

        {canRemove ? (
          <section className="flex flex-col gap-2 border-t pt-4">
            <h3 className="text-sm font-semibold">Remove {firstName(member)}</h3>
            <p className="text-sm text-muted-foreground">
              They lose access to the organization. Their open Inbox items return to
              Unassigned.
            </p>
            <div>
              <RemoveMemberDialog
                memberName={member.name}
                memberEmail={member.email}
                onRemove={() =>
                  void removeMemberAction({ data: { memberId: member.id } })
                    .then(onClose)
                    .catch(() => undefined)
                }
                isPending={removeMemberAction.isPending}
              />
            </div>
          </section>
        ) : null}
      </div>

      <SheetFooter className="flex-row justify-end">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={save}
          disabled={change.isEmpty || saveAction.isPending}
        >
          {saveAction.isPending ? 'Saving…' : 'Save access'}
        </Button>
      </SheetFooter>
    </div>
  )
}

export function MemberAccessSheet(props: Props) {
  const { member, onClose, responsibility } = props
  return (
    <Sheet
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {member ? `Edit access for ${member.name}` : 'Edit access'}
          </SheetTitle>
          <SheetDescription>{member?.email}</SheetDescription>
        </SheetHeader>
        {member && responsibility.status === 'loading' ? (
          <div className="flex flex-col gap-3 px-4" aria-busy="true">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
            <span className="sr-only">Loading access…</span>
          </div>
        ) : null}
        {member && responsibility.status !== 'loading' ? (
          <AccessForm key={member.id} {...props} member={member} />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
