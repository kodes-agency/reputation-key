// Identity context — update organization use case.
// Moves authorization from server function into the use case layer.
// The Better Auth payload semantics (field inclusion + null→undefined) live in
// the OrganizationUpdatePatch builder (../organization-update-patch).

import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { identityError } from '../../domain/errors'
import { validateSlug, validateOrganizationName } from '../../domain/rules'
import { buildOrganizationUpdatePatch } from '../organization-update-patch'
import type { UpdateOrganizationInput } from '../organization-update-patch'

export type { UpdateOrganizationInput } from '../organization-update-patch'

export type UpdateOrganizationDeps = Readonly<{
  updateOrg: (data: Record<string, unknown>) => Promise<void>
}>

export const updateOrganization =
  (deps: UpdateOrganizationDeps) =>
  async (input: UpdateOrganizationInput, ctx: AuthContext): Promise<void> => {
    // 1. Authorize
    if (!canForContext(ctx, 'organization.update')) {
      throw identityError(
        'forbidden',
        'Only AccountAdmin or PropertyManager can update organization',
      )
    }
    // 2. Validate slug/name if provided
    if (input.slug !== undefined) {
      const slugResult = validateSlug(input.slug)
      if (slugResult.isErr()) {
        throw identityError(slugResult.error.code, slugResult.error.message)
      }
    }
    if (input.name !== undefined) {
      const nameResult = validateOrganizationName(input.name)
      if (nameResult.isErr()) {
        throw identityError(nameResult.error.code, nameResult.error.message)
      }
    }

    // 3. Delegate to auth provider with the Better Auth payload
    await deps.updateOrg(buildOrganizationUpdatePatch(input))
  }

export type UpdateOrganization = ReturnType<typeof updateOrganization>
