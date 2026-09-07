/**
 * Organization-plugin custom schema — single source of truth.
 *
 * Imported by BOTH:
 *   - auth.ts      (runtime config)
 *   - auth-cli.ts  (the repository-pinned schema-management config)
 *
 * Schema management MUST see the same `additionalFields` as the runtime. Previously
 * auth-cli.ts omitted them, so `pnpm auth:migrate` could not manage these columns
 * and they silently drifted from the live database — the root cause of earlier
 * additional-field migration gaps.
 *
 * Keep this module free of Vite path aliases (`#/...`): auth-cli.ts runs
 * outside the Vite resolver and imports it via a relative path.
 */

export const organizationSchema = {
  invitation: {
    additionalFields: {
      // JSON-stringified array of property IDs selected at invite time;
      // consumed after acceptance to create explicit PropertyAccessGrants.
      propertyIds: {
        type: 'string' as const,
        input: true,
        required: false,
      },
    },
  },
  organization: {
    additionalFields: {
      contactEmail: {
        type: 'string' as const,
        input: true,
        required: false,
      },
    },
  },
} as const
