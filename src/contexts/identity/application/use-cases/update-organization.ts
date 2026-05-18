// Identity context — update organization use case.
// Moves authorization from server function into the use case layer.

import type { AuthContext } from '#/shared/domain/auth-context'
import { can } from '#/shared/domain/permissions'
import { identityError } from '../../domain/errors'

export type UpdateOrganizationDeps = Readonly<{
  updateOrg: (headers: Headers, data: Record<string, unknown>) => Promise<void>
  getHeaders: () => Headers | undefined
}>

export type UpdateOrganizationInput = Readonly<{
  name?: string
  slug?: string
  logo?: string | null
  contactEmail?: string | null
  billingCompanyName?: string | null
  billingAddress?: string | null
  billingCity?: string | null
  billingPostalCode?: string | null
  billingCountry?: string | null
}>

export const updateOrganization =
  (deps: UpdateOrganizationDeps) =>
  async (input: UpdateOrganizationInput, ctx: AuthContext): Promise<void> => {
    // 1. Authorize
    if (!can(ctx.role, 'organization.update')) {
      throw identityError(
        'forbidden',
        'Only AccountAdmin or PropertyManager can update organization',
      )
    }

    // 2. Build update payload — convert nulls to undefined for Better Auth
    const updateData: Record<string, unknown> = {
      ...(input.name && { name: input.name }),
      ...(input.slug && { slug: input.slug }),
      logo: input.logo ?? undefined,
      ...(input.contactEmail !== undefined && {
        contactEmail: input.contactEmail ?? undefined,
      }),
      ...(input.billingCompanyName !== undefined && {
        billingCompanyName: input.billingCompanyName ?? undefined,
      }),
      ...(input.billingAddress !== undefined && {
        billingAddress: input.billingAddress ?? undefined,
      }),
      ...(input.billingCity !== undefined && {
        billingCity: input.billingCity ?? undefined,
      }),
      ...(input.billingPostalCode !== undefined && {
        billingPostalCode: input.billingPostalCode ?? undefined,
      }),
      ...(input.billingCountry !== undefined && {
        billingCountry: input.billingCountry ?? undefined,
      }),
    }

    // 3. Delegate to auth provider
    const headers = deps.getHeaders()
    if (!headers) {
      throw identityError('validation_error', 'Request headers not available')
    }
    await deps.updateOrg(headers, updateData)
  }

export type UpdateOrganization = ReturnType<typeof updateOrganization>
