// Subject check for the manual rights script: the Organization a request names
// exists and, for a Property request, the Property belongs to it. Read-only, so
// a typo or a Property of another Organization is refused before any executor
// journals or changes a row.

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { organization } from '#/shared/db/schema/auth'
import { properties } from '#/shared/db/schema/property.schema'

export type RightsSubject = Readonly<{
  scope: string
  organizationId: string
  propertyId?: string
}>

/** Why the request's subject does not exist, or null when it does. */
export async function rightsSubjectRefusal(
  db: Database,
  plan: RightsSubject,
): Promise<string | null> {
  const [org] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, plan.organizationId))
    .limit(1)
  if (!org) return 'the Organization does not exist'
  if (plan.scope !== 'property' && plan.scope !== 'guest-response') return null
  if (!plan.propertyId) return null
  const [property] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(
      and(
        eq(properties.id, plan.propertyId),
        eq(properties.organizationId, plan.organizationId),
      ),
    )
    .limit(1)
  return property ? null : 'the Property does not belong to the Organization'
}
