// Identity context — DTOs for custom-role management (ADR 0001).
// Zod schemas for input shapes that cross network boundaries.
// Permission strings are NOT validated here: the use case's escalation check rejects
// any string that isn't in the caller's effectivePermissions (so unknown/garbage
// permissions are denied) — and the application layer can't import shared/auth where
// the catalogue lives (boundary rule).

import { z } from 'zod/v4'

/** Reusable role-name schema: 3–64 chars, lowercase, letter-led, no reserved names. */
export const customRoleNameSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(
    /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/,
    'Role must be 3–64 chars, lowercase, start with a letter, and contain only lowercase letters, digits, and hyphens',
  )
  .refine((r) => !['owner', 'admin', 'member'].includes(r), {
    message: 'Role name is reserved',
  })

export const dataScopeSchema = z.enum(['organization', 'assigned-properties', 'none'])
export const permissionsSchema = z
  .array(z.string().min(1))
  .min(1, 'At least one permission is required')

export const createCustomRoleInputSchema = z.object({
  role: customRoleNameSchema,
  permissions: permissionsSchema,
  dataScope: dataScopeSchema,
})
export type CreateCustomRoleInput = Readonly<z.infer<typeof createCustomRoleInputSchema>>

export const updateCustomRoleInputSchema = z.object({
  role: customRoleNameSchema,
  permissions: permissionsSchema,
  dataScope: dataScopeSchema,
})
export type UpdateCustomRoleInput = Readonly<z.infer<typeof updateCustomRoleInputSchema>>

export const deleteCustomRoleInputSchema = z.object({
  role: customRoleNameSchema,
})
export type DeleteCustomRoleInput = Readonly<z.infer<typeof deleteCustomRoleInputSchema>>
