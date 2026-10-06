/** Stable organization seeded by `seed:e2e-user` and allowlisted by e2e/stack.env. */
export const LOCAL_E2E_ORGANIZATION_ID = 'e2e-org-a'

/**
 * The seeded owner's user id, fixed so e2e/stack.env can list the account as
 * the platform operator (`user:<id>`, ADR 0065). Better Auth's own id shape:
 * 32 alphanumeric characters.
 */
export const LOCAL_E2E_OPERATOR_USER_ID = 'E2eSeededOwnerPlatformOperator01'

/** Auditable identity for the web process that exercises the auth rate-limit hatch. */
export const LOCAL_E2E_EXECUTION_IDENTITY = 'local-playwright-e2e'
