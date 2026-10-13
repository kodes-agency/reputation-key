// Identity context — DTO for creating an Organization.
// Zod schema for `createOrganizationFn`, which stays dormant behind the blocked
// `organization.create` capability. It lives here, not inline in the server
// function, so its tests run the schema production runs: the server function's
// module cannot be imported by a unit test.

import { z } from 'zod/v4'
import { validateSlug } from '../../domain/rules'

export const createOrganizationInputSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .superRefine((s, ctx) => {
      // Route through the domain rule so this server fn cannot persist slugs
      // the domain rejects (the old inline regex accepted single-char slugs
      // and leading/trailing hyphens — weaker than validateSlug).
      const result = validateSlug(s)
      if (result.isErr()) {
        ctx.addIssue({ code: 'custom', message: result.error.message })
      }
    }),
})
