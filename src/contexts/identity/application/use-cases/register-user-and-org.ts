// Identity context — register user and create organization use case
// Multi-step orchestration with domain rules (normalizeSlug, validateOrganizationName).
// Per architecture: use cases THROW tagged errors at the application boundary.

import type { EventBus } from '#/shared/events/event-bus'
import { normalizeSlug, validateOrganizationName } from '../../domain/rules'
import { identityError } from '../../domain/errors'
import { organizationCreated } from '../../domain/events'
import {
  organizationId as toOrganizationId,
  userId as toUserId,
} from '#/shared/domain/ids'

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

type Deps = Readonly<{
  events: EventBus
  /** Sign up a new user with email+password. Returns user ID or throws. */
  signUp: (name: string, email: string, password: string) => Promise<string>
  /** Create an organization with the given name and slug. Accepts optional userId for server-side creation. */
  createOrg: (
    headers: Headers,
    name: string,
    slug: string,
    userId?: string,
  ) => Promise<string>
  /** Set the active organization for the current session. */
  setActiveOrg: (headers: Headers, orgId: string) => Promise<void>
  /** Build headers carrying the current request session. */
  headers: () => Headers
  /** Injectable clock for deterministic timestamps. */
  clock: () => Date
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
  (deps: Deps) =>
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
    const headers = deps.headers()
    let orgId: string
    try {
      orgId = await deps.createOrg(headers, validName, slug, userId)
      await deps.setActiveOrg(headers, orgId)
    } catch (e) {
      // User was created but org setup failed — distinct error so the client
      // can prompt "you have an account, please sign in and create an org"
      throw identityError(
        'org_setup_failed',
        `Account created, but organization setup failed: ${e instanceof Error ? e.message : 'unknown error'}`,
      )
    }

    // 5. Emit event
    deps.events.emit(
      organizationCreated({
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
