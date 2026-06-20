/**
 * Organization-plugin custom schema — single source of truth.
 *
 * Imported by BOTH:
 *   - auth.ts      (runtime config)
 *   - auth-cli.ts  (the @better-auth/cli migration-tool config)
 *
 * The CLI MUST see the same `additionalFields` as the runtime. Previously
 * auth-cli.ts omitted them, so `pnpm auth:generate` / `auth:migrate` could not
 * manage these columns and they silently drifted from the live database — the
 * root cause of the `propertyIds` and org billing-column migration gaps.
 *
 * Keep this module free of Vite path aliases (`#/...`): auth-cli.ts runs
 * outside the Vite resolver and imports it via a relative path.
 */

export const organizationSchema = {
  invitation: {
    additionalFields: {
      // JSON-stringified array of property IDs selected at invite time;
      // consumed by the afterAcceptInvitation hook to create staff_assignments.
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
      billingCompanyName: {
        type: 'string' as const,
        input: true,
        required: false,
      },
      billingAddress: {
        type: 'string' as const,
        input: true,
        required: false,
      },
      billingCity: {
        type: 'string' as const,
        input: true,
        required: false,
      },
      billingPostalCode: {
        type: 'string' as const,
        input: true,
        required: false,
      },
      billingCountry: {
        type: 'string' as const,
        input: true,
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
