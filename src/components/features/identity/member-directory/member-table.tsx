/**
 * MemberTable — the Organization's members, what each can do and which
 * properties they work. The table only reports what was chosen: the route owns
 * the Change role dialog and the Manage access sheet, so their data loading and
 * mutations stay out of the rows.
 */

import { Contact, TriangleAlert } from 'lucide-react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { RoleBadge } from '#/components/features/identity/shared/role-badge'
import { Button } from '#/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import type { Action } from '#/components/hooks/use-action'
import { EmptyState } from '#/components/ui/empty-state'
import type { Role } from '#/shared/domain/roles'
import { RemoveMemberDialog } from './remove-member-dialog'
import { summarizeProperties } from './property-summary'

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
   * The route's Action reports its own outcome (toasts); a refusal still rejects
   * the call, so the click settles the promise rather than leaking it.
   */
  removeMemberAction: Action<{ data: { memberId: string } }>
}>

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
          <TriangleAlert className="size-3.5" aria-hidden="true" />
          No properties
        </span>
        <span className="text-xs text-muted-foreground">Sees an empty app</span>
      </div>
    )
  }
  const { shown, hiddenCount, all } = summarizeProperties(properties)
  return (
    <span title={hiddenCount > 0 ? all : undefined}>
      {shown.join(', ')}
      {hiddenCount > 0 ? (
        <span className="text-muted-foreground"> +{hiddenCount} more</span>
      ) : null}
    </span>
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
      <EmptyState icon={Contact} title="No members">
        <p className="text-sm text-muted-foreground">
          Invite members to your organization using the button above.
        </p>
      </EmptyState>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Person</TableHead>
          <TableHead>Role</TableHead>
          {showProperties && <TableHead>Properties</TableHead>}
          {canManageMembers && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => {
          const isSelf = member.userId === currentUserId
          return (
            <TableRow key={member.id}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium">
                    {member.name}
                    {isSelf ? (
                      <span className="ml-1 font-normal text-muted-foreground">
                        (you)
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground">{member.email}</span>
                </div>
              </TableCell>
              <TableCell>
                <RoleBadge role={member.role} rawRole={member.rawRole} />
              </TableCell>
              {showProperties && (
                <TableCell>
                  <PropertiesCell member={member} />
                </TableCell>
              )}
              {canManageMembers ? (
                <TableCell className="text-right">
                  {isSelf ? null : (
                    <div className="flex flex-wrap justify-end gap-2">
                      {canChangeRoles ? (
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Change role for ${member.name}`}
                          onClick={() => onChangeRole(member)}
                        >
                          Change role
                        </Button>
                      ) : null}
                      {canEditAccess && member.role === 'PropertyManager' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Edit access for ${member.name}`}
                          onClick={() => onEditAccess(member)}
                        >
                          Edit access
                        </Button>
                      ) : null}
                      {canRemove ? (
                        <RemoveMemberDialog
                          memberName={member.name}
                          memberEmail={member.email}
                          onRemove={() =>
                            void removeMemberAction({
                              data: { memberId: member.id },
                            }).catch(() => undefined)
                          }
                          isPending={removeMemberAction.isPending}
                        />
                      ) : null}
                    </div>
                  )}
                </TableCell>
              ) : null}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
