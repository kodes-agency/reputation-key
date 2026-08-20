import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { AiReadDeliveryLease } from '../../domain/types'

type SqlExecutor = Pick<Database, 'execute'>
type InternalAiReadDeliveryLease = AiReadDeliveryLease &
  Readonly<{
    organizationGeneration: number
    propertyGeneration: number
    actorGeneration: number
  }>

function positiveGeneration(value: unknown): number | null {
  const generation = typeof value === 'string' ? Number(value) : value
  return typeof generation === 'number' &&
    Number.isSafeInteger(generation) &&
    generation >= 1
    ? generation
    : null
}

export async function acquireAiReadDeliveryLease(
  tx: SqlExecutor,
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    actorUserId: UserId
  }>,
): Promise<AiReadDeliveryLease | null> {
  const result = await tx.execute(sql`
    SELECT *
    FROM acquire_ai_read_delivery_v1(
      ${input.organizationId},
      ${input.propertyId}::uuid,
      ${input.actorUserId}
    )
  `)
  if (result.rows.length !== 1) return null
  const row = result.rows[0] as Readonly<Record<string, unknown>>
  const organizationGeneration = positiveGeneration(row.organization_generation)
  const propertyGeneration = positiveGeneration(row.property_generation)
  const actorGeneration = positiveGeneration(row.actor_generation)
  if (
    organizationGeneration === null ||
    propertyGeneration === null ||
    actorGeneration === null
  ) {
    return null
  }
  return Object.assign(Object.create(null) as InternalAiReadDeliveryLease, {
    organizationGeneration,
    propertyGeneration,
    actorGeneration,
  })
}

export async function assertAiReadDeliveryLease(
  tx: SqlExecutor,
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    actorUserId: UserId
    lease: AiReadDeliveryLease
  }>,
): Promise<boolean> {
  const lease = input.lease as InternalAiReadDeliveryLease
  const result = await tx.execute(sql`
    SELECT assert_ai_read_delivery_v1(
      ${input.organizationId},
      ${input.propertyId}::uuid,
      ${input.actorUserId},
      ${lease.organizationGeneration},
      ${lease.propertyGeneration},
      ${lease.actorGeneration}
    ) AS valid
  `)
  return (
    result.rows.length === 1 && (result.rows[0] as { valid?: unknown }).valid === true
  )
}

export async function closeAiReadBarrier(
  tx: SqlExecutor,
  input: Readonly<{
    scopeKind: 'organization' | 'property' | 'actor'
    scopeId: string
    expectedGeneration: number
  }>,
): Promise<number> {
  const result = await tx.execute(sql`
    SELECT close_ai_read_barrier_v1(
      ${input.scopeKind},
      ${input.scopeId},
      ${input.expectedGeneration}
    ) AS generation
  `)
  const generation = positiveGeneration(
    (result.rows[0] as Readonly<{ generation?: unknown }> | undefined)?.generation,
  )
  if (result.rows.length !== 1 || generation === null) {
    throw new Error('AI read barrier close failed')
  }
  return generation
}
