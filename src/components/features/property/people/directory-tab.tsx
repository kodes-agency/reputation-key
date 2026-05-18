import { TabsContent } from '#/components/ui/tabs'
import { Badge } from '#/components/ui/badge'
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
    role: string | null
  }>
}

export function DirectoryTab({ members }: DirectoryTabProps) {
  return (
    <TabsContent value="directory" className="mt-4">
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members found.</p>
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
                  {member.role ? (
                    <Badge variant="secondary">{member.role}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TabsContent>
  )
}
