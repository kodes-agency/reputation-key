// Portal context — PortalGroup domain constructors
import { ok, err, type Result } from 'neverthrow'
import type { PortalGroup } from './portal-group-types'
import type { PortalError } from './errors'
import type { OrganizationId, PortalGroupId, PropertyId } from '#/shared/domain/ids'

export type BuildPortalGroupInput = Readonly<{
  id: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  now: Date
}>

export const buildPortalGroup = (
  input: BuildPortalGroupInput,
): Result<PortalGroup, PortalError> => {
  if (!input.name.trim()) {
    return err({
      _tag: 'PortalError',
      code: 'invalid_name',
      message: 'Group name is required',
    })
  }
  if (input.name.length > 100) {
    return err({
      _tag: 'PortalError',
      code: 'invalid_name',
      message: 'Group name must be at most 100 characters',
    })
  }

  return ok({
    id: input.id,
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    name: input.name.trim(),
    createdAt: input.now,
    updatedAt: input.now,
  })
}
