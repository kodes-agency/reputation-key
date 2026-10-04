import { Contact } from 'lucide-react'
import { EmptyState } from '#/components/ui/empty-state'
import { RoleBadge } from '#/components/features/identity/shared/role-badge'
import type { Role } from '#/shared/domain/roles'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'

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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.userId}>
                <TableCell className="font-medium">{member.name}</TableCell>
                <TableCell className="text-muted-foreground">{member.email}</TableCell>
                <TableCell>
                  <RoleBadge role={member.role} rawRole={member.rawRole} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}
