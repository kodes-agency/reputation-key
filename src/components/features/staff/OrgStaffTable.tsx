/**
 * OrgStaffTable — org-wide staff assignments table with property links.
 * Extracted from org-level staff route.
 */

import { Link } from '@tanstack/react-router'
import type { MemberLike, AssignmentLike } from '#/lib/lookups'
import { buildMemberLookup } from '#/lib/lookups'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Building2 } from 'lucide-react'

interface OrgAssignment extends AssignmentLike {
  propertyName: string
  propertyId: string
}

type Props = Readonly<{
  assignments: ReadonlyArray<OrgAssignment>
  members: ReadonlyArray<MemberLike>
}>

export function OrgStaffTable({ assignments, members }: Props) {
  const memberLookup = buildMemberLookup(members)

  if (assignments.length === 0) {
    return (
      <>
        <p className="text-muted-foreground">No staff assignments yet.</p>
        <p className="text-sm text-muted-foreground">
          Assign staff to properties to see them here.
        </p>
      </>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Property</TableHead>
          <TableHead>Team</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assignments.map((a) => {
          const member = memberLookup.get(a.userId)
          return (
            <TableRow key={a.id}>
              <TableCell className="font-medium">
                {member ? member.name : a.userId}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {member ? member.email : '—'}
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="sm" asChild>
                  <Link
                    to="/properties/$propertyId/people"
                    params={{ propertyId: a.propertyId }}
                  >
                    <Building2 />
                    {a.propertyName}
                  </Link>
                </Button>
              </TableCell>
              <TableCell>
                {a.teamId ? (
                  <Badge variant="secondary">Team assigned</Badge>
                ) : (
                  <Badge variant="outline">Direct</Badge>
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
