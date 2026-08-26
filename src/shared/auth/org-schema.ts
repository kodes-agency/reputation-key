/**
 * Organization-plugin custom schema — single source of truth.
 *
 * Imported by BOTH:
 *   - auth.ts      (runtime config)
 *   - auth-cli.ts  (the repository-pinned schema-management config)
 *
 * Schema management MUST see the same `additionalFields` as the runtime. Previously
 * auth-cli.ts omitted them, so `pnpm auth:generate` / `auth:migrate` could not
 * manage these columns and they silently drifted from the live database — the
 * root cause of earlier additional-field migration gaps.
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
      // Compatibility storage only. Better Auth must retain these columns in
      // its schema authority while excluding them from every API input and
      // response. Removal waits for the separately approved erase/contraction
      // lifecycle; dormant data is not a beta product surface.
      billingCompanyName: {
        type: 'string' as const,
        input: false,
        returned: false,
        required: false,
      },
      billingAddress: {
        type: 'string' as const,
        input: false,
        returned: false,
        required: false,
      },
      billingCity: {
        type: 'string' as const,
        input: false,
        returned: false,
        required: false,
      },
      billingPostalCode: {
        type: 'string' as const,
        input: false,
        returned: false,
        required: false,
      },
      billingCountry: {
        type: 'string' as const,
        input: false,
        returned: false,
        required: false,
      },
      // Feeds the dashboard "attention band" signal: unanswered reviews past SLA.
      responseSlaHours: {
        type: 'number' as const,
        input: true,
        required: false,
      },
    },
  },
} as const
