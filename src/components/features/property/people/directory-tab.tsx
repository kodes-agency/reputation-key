import { Contact } from 'lucide-react'
import { EmptyState } from '#/components/ui/empty-state'
import { RoleBadge } from '#/components/features/identity/shared/role-badge'
import type { Role } from '#/shared/domain/roles'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '#/components/ui/data-table'

interface DirectoryTabProps {
  members: ReadonlyArray<{
    userId: string
    name: string
    email: string
    /** The built-in role, or null for a custom-only member (then `rawRole` is shown). */
    role: Role | null
    rawRole: string
  }>
}

export function DirectoryTab({ members }: DirectoryTabProps) {
  return (
    <>
      {members.length === 0 ? (
        <EmptyState icon={Contact} title="No members found" />
      ) : (
        <DataTable label="Directory" from="3xl">
          <DataTableHeader>
            <DataTableHead>Name</DataTableHead>
            <DataTableHead>Email</DataTableHead>
            <DataTableHead>Role</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {members.map((member) => (
              <DataTableRow key={member.userId}>
                <DataTableCell className="col-start-1 row-start-1 min-w-0 font-medium whitespace-normal">
                  {member.name}
                </DataTableCell>
                <DataTableCell className="col-start-1 row-start-2 min-w-0 text-muted-foreground whitespace-normal">
                  {member.email}
                </DataTableCell>
                <DataTableCell className="col-start-2 row-span-2 row-start-1 self-center">
                  <RoleBadge role={member.role} rawRole={member.rawRole} />
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}
    </>
  )
}
