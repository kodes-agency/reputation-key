// Identity context — DTOs for custom-role management (ADR 0001).
// Zod schemas for input shapes that cross network boundaries.
// Permission strings are NOT validated here: the use case's escalation check rejects
// any string that isn't in the caller's effectivePermissions (so unknown/garbage
// permissions are denied) — and the application layer can't import shared/auth where
// the catalogue lives (boundary rule).

import { z } from 'zod/v4'

export const createCustomRoleInputSchema = z.object({
  role: z
    .string()
    .min(3)
    .max(64)
    .regex(
      /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/,
      'Role must be 3–64 chars, lowercase, start with a letter, and contain only lowercase letters, digits, and hyphens',
    )
    .refine((r) => !['owner', 'admin', 'member'].includes(r), {
      message: 'Role name is reserved',
    }),
  permissions: z.array(z.string().min(1)).min(1, 'At least one permission is required'),
  dataScope: z.enum(['organization', 'assigned-properties', 'none']),
})

export type CreateCustomRoleInput = Readonly<z.infer<typeof createCustomRoleInputSchema>>
