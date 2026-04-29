// Org-level staff list — aggregates staff assignments across all properties
// P2 gap: Provides an org-wide view of who is assigned where.

import { createFileRoute } from '@tanstack/react-router'
import { listProperties } from '#/contexts/property/server/properties'
import { listStaffAssignments } from '#/contexts/staff/server/staff-assignments'
import { listMembers } from '#/contexts/identity/server/organizations'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Users, Building2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/staff/')({
  loader: async () => {
    const [{ properties }, { members }] = await Promise.all([
      listProperties(),
      listMembers(),
    ])

    const assignments = []
    if (properties.length > 0) {
      const results = await Promise.all(
        properties.map(async (p) => {
          const res = await listStaffAssignments({ data: { propertyId: p.id } })
          return res.assignments.map((a) => ({
            ...a,
            propertyName: p.name,
            propertyId: p.id,
          }))
        }),
      )
      assignments.push(...results.flat())
    }

    return { properties, members, assignments }
  },
  component: OrgStaffPage,
})

function OrgStaffPage() {
  const { members, assignments } = Route.useLoaderData()

  // Build lookups
  const memberLookup = new Map<string, { name: string; email: string }>()
  for (const m of members) {
    memberLookup.set(m.userId, { name: m.name, email: m.email })
  }

  return (
    <div className="page-wrap px-4 pb-8 pt-14">
      <Card className="island-shell rise-in rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Users />
            Organization Staff
          </CardTitle>
          <CardDescription>All staff assignments across your properties.</CardDescription>
        </CardHeader>

        <CardContent>
          {assignments.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
                <p className="text-muted-foreground">No staff assignments yet.</p>
                <p className="text-sm text-muted-foreground">
                  Assign staff to properties to see them here.
                </p>
              </CardContent>
            </Card>
          ) : (
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
                            to="/properties/$propertyId/staff"
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
          )}
        </CardContent>
      </Card>
    </div>
  )
}
