// Identity context — register user and create organization use case
// Multi-step orchestration with domain rules (normalizeSlug, validateOrganizationName).
// Per architecture: use cases THROW tagged errors at the application boundary.
// BQC-3.5: the organization + owner-member rows and the organization.created
// fact now commit in ONE transaction via the command store (the fact is the
// audit trail — no consumers).

import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type { OrganizationId } from '#/shared/domain/ids'
import { normalizeSlug, validateOrganizationName } from '../../domain/rules'
import { identityError } from '../../domain/errors'
import { identityOrganizationCreated } from '../../domain/events'
import { userId as toUserId } from '#/shared/domain/ids'
/** Minimal logger surface this use case needs for compensating-transaction
 * diagnostics. Injected (not imported from shared/observability) so the
 * application layer stays free of infrastructure dependencies. */
export type RegisterUserAndOrgLogger = {
  error: (obj: object, message?: string) => void
}

// fallow-ignore-next-line unused-type
export type RegisterUserAndOrgInput = Readonly<{
  name: string
  email: string
  password: string
  organizationName: string
}>

// fallow-ignore-next-line unused-type
export type RegisterUserAndOrgOutput = Readonly<{
  organizationId: string
}>
export type RegisterUserAndOrg = ReturnType<typeof registerUserAndOrg>

export type RegisterUserAndOrgDeps = Readonly<{
  /** Sign up a new user with email+password. Returns user ID or throws. */
  signUp: (name: string, email: string, password: string) => Promise<string>
  /** Set the active organization for the current session. */
  setActiveOrg: (orgId: string) => Promise<void>
  /** Injectable clock for deterministic timestamps. */
  clock: () => Date
  /** Organization id generator. */
  idGen: () => OrganizationId
  /** Atomic organization + owner-member + fact write. */
  commandStore: IdentityCommandStore
  /** Delete a user (compensating transaction for registration rollback). */
  deleteUser: (userId: string) => Promise<void>
  /** Logger for compensating-transaction diagnostics (injected, not imported). */
  logger: RegisterUserAndOrgLogger
}>

/** Extract a readable message from Error instances and tagged domain errors. */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as { message: unknown }).message)
  }
  return 'unknown error'
}

/**
 * Register a new user and create their first organization.
 *
 * Steps:
 * 1. Validate — organization name (domain rule)
 * 2. Persist user — sign up via auth API
 * 3. Persist org — organization + owner member + created fact, atomic
 * 4. Set active org
 * 5. Return
 */
export const registerUserAndOrg =
  (deps: RegisterUserAndOrgDeps) =>
  async (input: RegisterUserAndOrgInput): Promise<RegisterUserAndOrgOutput> => {
    // 1. Validate organization name using domain rule
    const nameResult = validateOrganizationName(input.organizationName)
    if (nameResult.isErr()) {
      throw identityError(nameResult.error.code, nameResult.error.message)
    }
    const validName = nameResult.value
    const slug = normalizeSlug(validName)

    // 2. Sign up the user
    let userId: string
    try {
      userId = await deps.signUp(input.name, input.email, input.password)
    } catch (e) {
      throw identityError(
        'registration_failed',
        e instanceof Error ? e.message : 'Registration failed',
      )
    }

    // 3–4. Create the org (atomic with the fact) and set it as active
    const orgId = deps.idGen()
    try {
      await deps.commandStore.registerOrganization({
        organizationId: orgId,
        organizationName: validName,
        slug,
        ownerId: toUserId(userId),
        now: deps.clock(),
        event: identityOrganizationCreated({
          organizationId: orgId,
          organizationName: validName,
          slug,
          ownerId: toUserId(userId),
          occurredAt: deps.clock(),
        }),
      })
      await deps.setActiveOrg(orgId as string)
    } catch (e) {
      // Compensating transaction: remove the orphaned user
      try {
        await deps.deleteUser(userId)
      } catch (cleanupErr) {
        // Compensating transaction failed — orphaned user requires manual cleanup
        deps.logger.error(
          { orphanedUserId: userId, originalError: e, cleanupError: cleanupErr },
          '[auth] COMPENSATING TX FAILED: orphaned user requires manual cleanup',
        )
      }
      throw identityError(
        'org_setup_failed',
        `Account created, but organization setup failed: ${errorMessage(e)}`,
      )
    }

    // 5. Return
    return { organizationId: orgId as string }
  }
