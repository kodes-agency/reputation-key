// Manage access: one sheet per Property Manager to choose which properties they
// can work and which of them they are responsible for, with a plain summary of
// the change above Save. Controlled by the route, which owns loading the
// member's current access and responsibility and saving the change.
//
// The sheet measures its draft against what the server held when the member's
// access and responsibility first arrived, not against the route's reads as
// they stand now. Those reads move under an open sheet (a focus refetch,
// another admin's grant, a failed refetch), and none of that may discard the
// draft or change what Save sends; the next open starts from the server again.
// The sheet cannot be left while a save or a removal is in flight: its success
// closes the route's one sheet, which by then could be another member's.

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
import {
  accessBaseline,
  diffMemberAccess,
  summarizeAccessChange,
  type AccessBaseline,
  type ResponsibilityState,
} from './member-access-diff'
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

export type { ResponsibilityState }

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

/** A save or a removal is in flight. */
const isBusy = (
  saveAction: Pick<Action<unknown>, 'isPending'>,
  removeMemberAction: Pick<Action<unknown>, 'isPending'>,
): boolean => saveAction.isPending || removeMemberAction.isPending

/** How the sheet addresses the member: their first name, else their address. */
function firstName(member: MemberAccessTarget): string {
  return member.name.trim().split(/\s+/)[0] || member.email
}

function AccessForm({
  member,
  onClose,
  properties,
  baseline,
  canRemove,
  saveAction,
  removeMemberAction,
}: Pick<
  Props,
  'onClose' | 'properties' | 'canRemove' | 'saveAction' | 'removeMemberAction'
> &
  Readonly<{ member: MemberAccessTarget; baseline: AccessBaseline }>) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => [
    ...baseline.propertyIds,
  ])
  const [responsibleIds, setResponsibleIds] = useState<string[]>(() => [
    ...baseline.responsibleIds,
  ])

  const change = diffMemberAccess(baseline, { propertyIds: selectedIds, responsibleIds })
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
            showResponsibility={baseline.responsibilityKnown}
            disabled={saveAction.isPending}
            onSelectedChange={setSelectedIds}
            onResponsibleChange={setResponsibleIds}
          />
          {!baseline.responsibilityKnown ? (
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
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={isBusy(saveAction, removeMemberAction)}
        >
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

/**
 * Holds the member's baseline from the moment it is first available until the
 * body unmounts (the sheet closes, or another member opens). The skeleton shows
 * only before then; later pending or failed reads change nothing on screen.
 */
function AccessBody(props: Props & Readonly<{ member: MemberAccessTarget }>) {
  const { member, properties, currentPropertyIds, responsibility } = props
  const settled = accessBaseline(
    currentPropertyIds,
    properties.map((property) => property.id),
    responsibility,
  )
  const [baseline, setBaseline] = useState<AccessBaseline | null>(settled)
  if (baseline === null && settled !== null) setBaseline(settled)

  if (baseline === null) {
    return (
      <div className="flex flex-col gap-3 px-4" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-24 w-full" />
        <span className="sr-only">Loading access…</span>
      </div>
    )
  }
  return (
    <AccessForm
      member={member}
      baseline={baseline}
      onClose={props.onClose}
      properties={properties}
      canRemove={props.canRemove}
      saveAction={props.saveAction}
      removeMemberAction={props.removeMemberAction}
    />
  )
}

export function MemberAccessSheet(props: Props) {
  const { member, onClose, saveAction, removeMemberAction } = props
  return (
    <Sheet
      open={member !== null}
      onOpenChange={(open) => {
        if (!open && !isBusy(saveAction, removeMemberAction)) onClose()
      }}
    >
      <SheetContent className="gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {member ? `Edit access for ${member.name}` : 'Edit access'}
          </SheetTitle>
          <SheetDescription>{member?.email}</SheetDescription>
        </SheetHeader>
        {member ? <AccessBody key={member.id} {...props} member={member} /> : null}
      </SheetContent>
    </Sheet>
  )
}
