/**
 * MemberTable — the Organization's members, what each can do and which
 * properties they work. The table only reports what was chosen: the route owns
 * the Change role dialog and the Edit access sheet, so their data loading and
 * mutations stay out of the rows. Removing is confirmed from the row's menu.
 */

import { Contact } from 'lucide-react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { RoleBadge } from '#/components/features/identity/shared/role-badge'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '#/components/ui/data-table'
import { TONE_ICON } from '#/components/ui/tone'
import type { Action } from '#/components/hooks/use-action'
import { EmptyState } from '#/components/ui/empty-state'
import type { Role } from '#/shared/domain/roles'
import { MemberRowActions } from './member-row-actions'
import { PropertyNames } from './property-names'

export interface PropertyRef {
  id: string
  name: string
}

export interface MemberRow {
  id: string
  userId: string
  name: string
  email: string
  role: Role | null
  rawRole: string
  /**
   * The properties a Property Manager can work. Left out for a viewer who may
   * not see Property access, who then gets no Properties column.
   */
  properties?: ReadonlyArray<PropertyRef>
}

type Props = Readonly<{
  members: ReadonlyArray<MemberRow>
  currentUserId: string
  /** Whether rows carry `properties`; false drops the Properties column. */
  showProperties: boolean
  onChangeRole: (member: MemberRow) => void
  onEditAccess: (member: MemberRow) => void
  /**
   * Removing is confirmed in a dialog, which stays open and says the refusal in
   * place, so this Action's rejection goes to the dialog.
   */
  removeMemberAction: Action<{ data: { memberId: string } }>
}>

const WarnIcon = TONE_ICON.warn

function PropertiesCell({ member }: Readonly<{ member: MemberRow }>) {
  if (member.role === 'AccountAdmin') {
    return (
      <div className="flex flex-col">
        <span>All properties</span>
        <span className="text-xs text-muted-foreground">and any added later</span>
      </div>
    )
  }
  if (member.role !== 'PropertyManager') {
    // A Member login or a custom role holds no Property scope in the beta.
    return <span className="text-muted-foreground">—</span>
  }
  const properties = member.properties ?? []
  if (properties.length === 0) {
    return (
      <div className="flex flex-col">
        <span className="inline-flex items-center gap-1 font-medium text-warn">
          <WarnIcon className="size-3.5" aria-hidden="true" />
          No properties
        </span>
        <span className="text-xs text-muted-foreground">Sees an empty app</span>
      </div>
    )
  }
  return <PropertyNames properties={properties} />
}

function PersonCell({
  member,
  isSelf,
}: Readonly<{ member: MemberRow; isSelf: boolean }>) {
  return (
    <div className="flex flex-col">
      <span className="font-medium">
        {member.name}
        {isSelf ? (
          <span className="ml-1 font-normal text-muted-foreground">(you)</span>
        ) : null}
      </span>
      <span className="text-muted-foreground">{member.email}</span>
    </div>
  )
}

export function MemberTable({
  members,
  currentUserId,
  showProperties,
  onChangeRole,
  onEditAccess,
  removeMemberAction,
}: Props) {
  const { can } = usePermissions()
  const canChangeRoles = can('member.update')
  const canEditAccess = can('member.update') && showProperties
  const canRemove = can('member.delete')
  const canManageMembers = canChangeRoles || canRemove

  if (members.length === 0) {
    return (
      <EmptyState
        icon={Contact}
        title="No members"
        description="Invite members to your organization using the button above."
      />
    )
  }

  return (
    <DataTable label="Members" from="3xl">
      <DataTableHeader>
        <DataTableHead>Person</DataTableHead>
        <DataTableHead>Role</DataTableHead>
        {showProperties ? <DataTableHead>Properties</DataTableHead> : null}
        {canManageMembers ? <DataTableHead actions /> : null}
      </DataTableHeader>
      <DataTableBody>
        {members.map((member) => {
          const isSelf = member.userId === currentUserId
          return (
            <DataTableRow key={member.id}>
              <DataTableCell className="col-start-1 row-start-1 min-w-0 whitespace-normal">
                <PersonCell member={member} isSelf={isSelf} />
              </DataTableCell>
              <DataTableCell className="col-start-2 row-start-2 justify-self-end">
                <RoleBadge role={member.role} rawRole={member.rawRole} />
              </DataTableCell>
              {showProperties ? (
                <DataTableCell className="col-start-1 row-start-2 min-w-0 whitespace-normal">
                  <PropertiesCell member={member} />
                </DataTableCell>
              ) : null}
              {canManageMembers ? (
                <DataTableCell actions className="col-start-2 row-start-1">
                  {isSelf ? null : (
                    <MemberRowActions
                      memberId={member.id}
                      name={member.name}
                      email={member.email}
                      onChangeRole={canChangeRoles ? () => onChangeRole(member) : null}
                      onEditAccess={
                        canEditAccess && member.role === 'PropertyManager'
                          ? () => onEditAccess(member)
                          : null
                      }
                      removeMemberAction={canRemove ? removeMemberAction : null}
                    />
                  )}
                </DataTableCell>
              ) : null}
            </DataTableRow>
          )
        })}
      </DataTableBody>
    </DataTable>
  )
}
