// Identity context — register user and create organization use case
// Multi-step orchestration with domain rules (normalizeSlug, validateOrganizationName).
// Per architecture: use cases THROW tagged errors at the application boundary.

import type { EventBus } from '#/shared/events/event-bus'
import { normalizeSlug, validateOrganizationName } from '../../domain/rules'
import { identityError } from '../../domain/errors'
import { identityOrganizationCreated } from '../../domain/events'
import {
  organizationId as toOrganizationId,
  userId as toUserId,
} from '#/shared/domain/ids'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'
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
  events: EventBus
  /** Sign up a new user with email+password. Returns user ID or throws. */
  signUp: (name: string, email: string, password: string) => Promise<string>
  /** Create an organization with the given name and slug. Accepts optional userId for server-side creation. */
  createOrg: (name: string, slug: string, userId?: string) => Promise<string>
  /** Set the active organization for the current session. */
  setActiveOrg: (orgId: string) => Promise<void>
  /** Injectable clock for deterministic timestamps. */
  clock: () => Date
  /** Delete a user (compensating transaction for registration rollback). */
  deleteUser: (userId: string) => Promise<void>
  /** Logger for compensating-transaction diagnostics (injected, not imported). */
  logger: RegisterUserAndOrgLogger
  outboxRepo?: OutboxRepository
}>

/**
 * Register a new user and create their first organization.
 *
 * Steps:
 * 1. Validate — organization name (domain rule)
 * 2. Persist user — sign up via auth API
 * 3. Persist org — create org with slug from domain rule
 * 4. Set active org
 * 5. Emit — organization.created event
 * 6. Return
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

    // 3–4. Create the org and set it as active
    // Pass userId to createOrganization so it works server-side
    // (the new user's session cookies aren't available yet).
    let orgId: string
    try {
      orgId = await deps.createOrg(validName, slug, userId)
      await deps.setActiveOrg(orgId)
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
        `Account created, but organization setup failed: ${e instanceof Error ? e.message : 'unknown error'}`,
      )
    }

    // 5. Emit event
    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      identityOrganizationCreated({
        organizationId: toOrganizationId(orgId),
        organizationName: validName,
        slug,
        ownerId: toUserId(userId),
        occurredAt: deps.clock(),
      }),
    )

    // 6. Return
    return { organizationId: orgId }
  }
