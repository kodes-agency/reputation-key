// Org-level staff list — aggregates staff assignments across all properties
// P2 gap: Provides an org-wide view of who is assigned where.

import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
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
import { Skeleton } from '#/components/ui/skeleton'
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
  component: OrgStaffPage,
})

function OrgStaffPage() {
  // Fetch all properties
  const propertiesQuery = useQuery({
    queryKey: ['properties'],
    queryFn: () => listProperties(),
  })

  // Fetch org members
  const membersQuery = useQuery({
    queryKey: ['org-members'],
    queryFn: () => listMembers(),
  })

  const properties = propertiesQuery.data?.properties ?? []

  // Fetch staff assignments for each property
  const assignmentsQueries = useQuery({
    queryKey: ['all-staff-assignments', properties.map((p) => p.id).join(',')],
    queryFn: async () => {
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
      return results.flat()
    },
    enabled: properties.length > 0,
  })

  // Build lookups
  const memberLookup = new Map<string, { name: string; email: string }>()
  for (const m of membersQuery.data?.members ?? []) {
    memberLookup.set(m.userId, { name: m.name, email: m.email })
  }

  const assignments = assignmentsQueries.data ?? []

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
          {propertiesQuery.isLoading || membersQuery.isLoading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : assignments.length === 0 ? (
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
