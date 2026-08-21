// Property context — create property use case
// Full 7-step pattern: authorize → validate refs → check uniqueness → build → persist → emit → return

import type { PropertyRepository } from '../ports/property.repository'
import type { PropertyCommandStore } from '../ports/property-command-store.port'
import type { Property, PropertyId } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { CreatePropertyInput } from '../dto/create-property.dto'
export type { CreatePropertyInput } from '../dto/create-property.dto'
import { canForContext } from '#/shared/domain/permissions'
import { normalizeSlug } from '../../domain/rules'
import { buildProperty } from '../../domain/constructors'
import { propertyError } from '../../domain/errors'
import { propertyCreated } from '../../domain/events'

export type CreatePropertyDeps = Readonly<{
  propertyRepo: PropertyRepository
  commandStore: PropertyCommandStore
  idGen: () => PropertyId
  clock: () => Date
  /**
   * Grant the new property the capability allowlist its organization already
   * holds. A freshly created property has an EMPTY `property_capability` set,
   * and an empty set denies every non-core capability with
   * `property_not_allowlisted` — so without this the property is dark for
   * Portals, Teams, Goals and Recognition with no in-product remedy.
   *
   * The Google import path provisions every property it creates; this closes
   * the same gap for the manual path. Absent = no provisioning.
   */
  provisionCapabilities?: (
    input: Readonly<{
      organizationId: string
      propertyId: string
      createdBy: string
    }>,
  ) => Promise<void>
  logger?: Readonly<{ warn: (obj: object, msg: string) => void }>
}>

/**
 * Provision the new property's capability allowlist from its organization.
 *
 * Deliberately outside the atomic command store and non-fatal: the property
 * exists and is usable, and provisioning is idempotent and repairable out of
 * band (`pnpm ops:property-capabilities sync`). Failing the creation here
 * would be a worse outcome than a dark new property.
 *
 * Extracted from `createProperty` so the use case stays under the complexity
 * gate; the try/catch and the content-free error shaping live here.
 */
async function provisionCreatedPropertyCapabilities(
  deps: CreatePropertyDeps,
  property: Property,
  createdBy: string,
): Promise<void> {
  if (!deps.provisionCapabilities) return
  try {
    await deps.provisionCapabilities({
      organizationId: property.organizationId,
      propertyId: property.id,
      createdBy,
    })
  } catch (error) {
    // Content-free: names and codes only, never a tenant identifier.
    deps.logger?.warn(
      { errorName: errorNameOf(error), errorCode: errorCodeOf(error) },
      'property capability provisioning failed',
    )
  }
}

function errorNameOf(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown'
}

function errorCodeOf(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object' || !('code' in error)) return undefined
  return String(error.code)
}

export const createProperty =
  (deps: CreatePropertyDeps) =>
  async (input: CreatePropertyInput, ctx: AuthContext): Promise<Property> => {
    // 1. Authorize
    if (!canForContext(ctx, 'property.create')) {
      throw propertyError('forbidden', 'this role cannot create properties')
    }

    // 2. (No referenced entities to validate for property creation)

    // 3. Check uniqueness — slug must be unique per org
    const candidateSlug = input.slug ?? normalizeSlug(input.name)
    if (await deps.propertyRepo.slugExists(ctx.organizationId, candidateSlug)) {
      throw propertyError(
        'slug_taken',
        'a property with this slug already exists in this organization',
      )
    }

    // 4. Build domain object (BQR-3.5: optional country resolves processing region)
    const propertyResult = buildProperty({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      name: input.name,
      providedSlug: input.slug,
      timezone: input.timezone,
      countryCode: input.countryCode ?? null,
      countrySource: input.countryCode ? 'manual' : undefined,
      now: deps.clock(),
    })

    if (propertyResult.isErr()) {
      throw propertyResult.error
    }

    const property = propertyResult.value

    // 5. Persist + fact — atomic via the command store (BQC-3.5)
    await deps.commandStore.createProperty({
      organizationId: ctx.organizationId,
      property,
      event: propertyCreated({
        propertyId: property.id,
        organizationId: property.organizationId,
        name: property.name,
        slug: property.slug,
        // BQC-4.1: content-free routing fact travels with the creation fact.
        processingRegion: property.processingRegion ?? undefined,
        occurredAt: property.createdAt,
      }),
    })

    // 6. Provision the property's capability allowlist (non-fatal; see helper).
    await provisionCreatedPropertyCapabilities(deps, property, ctx.userId)

    // 7. Return
    return property
  }

export type CreateProperty = ReturnType<typeof createProperty>
