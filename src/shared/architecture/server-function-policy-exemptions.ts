// The server functions that do not ask the execution policy, and why.
//
// `requireExecutionAllowed` decides for a signed-in member of an Organization:
// role, Property access and capability. A server function whose caller is not
// that (a guest, a person signing in, an operator), or whose question the
// policy cannot answer, asks something else. Each one is listed here with the
// guard it asks instead. server-function-policy.test.ts fails on a server
// function that does neither, and on an entry that no longer matches the code.
//
//   PUBLIC             no account is involved: a guest on a Portal, a person
//                      signing in or registering, the browser reading its
//                      runtime config. The public policy or a per-address
//                      admission decides.
//   SESSION            a signed-in account acting for itself where no
//                      Organization is resolved yet, or none is left.
//   OPERATOR           a platform operator, who holds no role in any
//                      Organization (ADR 0065).
//   AVAILABILITY-READ  tells the signed-in member's client what is available
//                      so it can avoid a dead end. It returns the decision and
//                      reads nothing the decision protects.
//   DECIDED-BELOW      the adapter resolves the caller and the application asks
//                      the policy itself. `decidedIn` names where.

export type ServerFunctionPolicyExemptionCategory =
  'PUBLIC' | 'SESSION' | 'OPERATOR' | 'AVAILABILITY-READ' | 'DECIDED-BELOW'

export type ServerFunctionPolicyExemption = Readonly<{
  /** Repository-relative path of the module that declares the function. */
  file: string
  /** The exported name of the server function. */
  name: string
  category: ServerFunctionPolicyExemptionCategory
  /**
   * The function the handler calls in place of the execution policy. Null only
   * where the adapter calls no named guard, and the reason says what does.
   */
  guard: string | null
  /** DECIDED-BELOW only: the module that asks the policy, and the call it makes. */
  decidedIn?: Readonly<{ file: string; call: string }>
  reason: string
}>

const GUEST_SCANS = 'src/contexts/guest/server/guest-scans.ts'
const GUEST_PUBLIC = 'src/contexts/guest/server/public.ts'
const REGISTRATION = 'src/contexts/identity/server/organizations.registration.ts'
const PLATFORM_CHANGES = 'src/contexts/identity/server/platform-console-changes.ts'
const GOOGLE_PERFORMANCE = 'src/contexts/integration/server/google-performance.ts'

const guestResponse = (name: string, action: string): ServerFunctionPolicyExemption => ({
  file: GUEST_PUBLIC,
  name,
  category: 'PUBLIC',
  guard: 'decidePublicExecution',
  reason: `A guest holds no account. The bound guest session asks the public policy for ${action} before anything is read or written.`,
})

const operatorChange = (name: string, change: string): ServerFunctionPolicyExemption => ({
  file: PLATFORM_CHANGES,
  name,
  category: 'OPERATOR',
  guard: 'requirePlatformOperator',
  reason: `The operator console ${change}. The caller must be a named platform operator with a recent sign-in and budget left; no Organization role exists to decide.`,
})

const googlePerformance = (
  name: string,
  what: string,
): ServerFunctionPolicyExemption => ({
  file: GOOGLE_PERFORMANCE,
  name,
  category: 'DECIDED-BELOW',
  guard: 'resolveTenantContext',
  decidedIn: {
    file: 'src/contexts/integration/application/google-performance-authorizer.ts',
    call: "decide('property.read_gbp_performance')",
  },
  reason: `${what} The Performance authorizer asks the execution policy with the member, the Property and property.read_gbp_performance, before the provider and again before the answer returns.`,
})

export const SERVER_FUNCTION_POLICY_EXEMPTIONS: readonly ServerFunctionPolicyExemption[] =
  [
    {
      file: 'src/contexts/feed/server/notifications.ts',
      name: 'getAccountAccessRemovalFn',
      category: 'SESSION',
      guard: 'requireAuth',
      reason:
        'Read by /unavailable for an account with no active Organization, so there is no tenant to decide for. The subject is the session user and the answer is one instant.',
    },
    {
      file: GUEST_SCANS,
      name: 'recordScanFn',
      category: 'PUBLIC',
      guard: 'decidePublicExecution',
      reason:
        'A guest opening a Portal holds no account. The public policy decides the scan for the Portal the token resolves to.',
    },
    {
      file: GUEST_SCANS,
      name: 'getPublicPortal',
      category: 'PUBLIC',
      guard: 'decidePublicExecution',
      reason:
        'The public Portal page. The public policy decides the read for the Portal the token resolves to.',
    },
    {
      file: GUEST_SCANS,
      name: 'resolvePublicPortalLink',
      category: 'DECIDED-BELOW',
      guard: null,
      decidedIn: {
        file: 'src/contexts/portal/application/use-cases/resolve-public-portal-token.ts',
        call: 'deps.decidePublic(',
      },
      reason:
        'Navigation-only link resolution for a guest. Resolving the Portal token is where the public policy is asked; a link outside that token resolves to nothing.',
    },
    guestResponse('submitGuestResponseFn', 'the rating'),
    guestResponse('correctGuestResponseFn', 'the correction'),
    guestResponse('startNewGuestResponseFn', 'the new response'),
    guestResponse('submitPrivateFeedbackFn', 'the private feedback'),
    guestResponse('withdrawPrivateFeedbackFn', 'the feedback withdrawal'),
    guestResponse('selectGoogleReviewFn', 'the Google review selection'),
    guestResponse('selectSecondaryLinkFn', 'the link selection'),
    guestResponse('withdrawGuestResponseFn', 'the response withdrawal'),
    {
      file: 'src/contexts/identity/server/auth-settings.org.ts',
      name: 'createOrganizationFn',
      category: 'SESSION',
      guard: 'assertGlobalCapability',
      reason:
        'The caller is creating the Organization, so none exists to decide for. organization.create is asserted globally and is beta_disabled.',
    },
    {
      file: 'src/contexts/identity/server/invitation-preview.ts',
      name: 'getInvitationPreview',
      category: 'PUBLIC',
      guard: null,
      reason:
        'Opened from the emailed link before any sign-in; the invitation id is the bearer secret. A per-address rate limit (rateLimiter.check) is the only gate, and every unusable id answers alike.',
    },
    {
      file: 'src/contexts/identity/server/organization-leave-fns.ts',
      name: 'getSelfServiceLeaveAvailabilityFn',
      category: 'AVAILABILITY-READ',
      guard: 'resolveTenantContext',
      reason:
        'Says whether this deployment composes self-service leave. The members page awaits it, so a refusal would take the directory down; the worklist read and the leave command keep their own policy calls.',
    },
    {
      file: 'src/contexts/identity/server/organizations.invitations.ts',
      name: 'acceptInvitation',
      category: 'SESSION',
      guard: 'requireAuth',
      reason:
        'The account is joining, so it may have no Organization yet. The use case asks the capability decision for the Organization the invitation names.',
    },
    {
      file: REGISTRATION,
      name: 'registerMember',
      category: 'PUBLIC',
      guard: 'admitAuthAttempt',
      reason:
        'Invited registration, before any account exists. A per-address admission gates the attempt and the use case refuses anything but a usable invitation.',
    },
    {
      file: REGISTRATION,
      name: 'signInUser',
      category: 'PUBLIC',
      guard: 'admitAuthAttempt',
      reason:
        'Sign-in, before any session exists. A per-address admission gates the attempt.',
    },
    {
      file: REGISTRATION,
      name: 'resendVerificationEmail',
      category: 'PUBLIC',
      guard: 'enforceVerificationResendRateLimit',
      reason:
        'Anonymous recovery for an unverified address. It is rate limited and answers the same whatever happened.',
    },
    {
      file: REGISTRATION,
      name: 'setActiveOrganization',
      category: 'SESSION',
      guard: 'checkUserOrganizationMembership',
      reason:
        'Chooses which Organization the session acts in, so no tenant context exists yet. The account must be a member of the Organization it names.',
    },
    {
      file: REGISTRATION,
      name: 'listUserInvitations',
      category: 'SESSION',
      guard: 'requireAuth',
      reason:
        'Lists the invitations addressed to the signed-in account, which may belong to no Organization yet.',
    },
    operatorChange('provisionOrganizationFn', 'creates an Organization'),
    operatorChange('inviteOrganizationAdminFn', 'invites the first Account Admin'),
    operatorChange('resendOrganizationAdminInvitationFn', 'resends that invitation'),
    operatorChange('cancelOrganizationAdminInvitationFn', 'cancels that invitation'),
    {
      file: 'src/contexts/identity/server/platform-console.ts',
      name: 'listPlatformOrganizationsFn',
      category: 'OPERATOR',
      guard: 'requirePlatformOperator',
      reason:
        'The operator console lists Organizations. The caller must be a named platform operator, re-checked on every call; no Organization role exists to decide.',
    },
    googlePerformance(
      'getPropertyGooglePerformance',
      'Live Google Performance for one Property.',
    ),
    googlePerformance(
      'renewPropertyGooglePerformanceLease',
      'Renews the lease of a Performance read.',
    ),
    {
      file: 'src/shared/auth/auth.functions.ts',
      name: 'getSession',
      category: 'SESSION',
      guard: 'getAuth',
      reason:
        'Reads the caller’s own session for the route guards. It is the fact every later decision starts from.',
    },
    {
      file: 'src/shared/auth/auth.functions.ts',
      name: 'ensureActiveOrg',
      category: 'SESSION',
      guard: 'readUserOrganizationMemberships',
      reason:
        'Makes the account’s single membership the active Organization. It runs before a tenant context exists and only ever selects an Organization the account belongs to.',
    },
    {
      file: 'src/shared/auth/capability-set.ts',
      name: 'getCapabilitySet',
      category: 'AVAILABILITY-READ',
      guard: 'checkBetaCapability',
      reason:
        'Returns the capability decisions for the member’s tenant so navigation can hide dead ends. It reads nothing a capability protects (ADR 0049).',
    },
    {
      file: 'src/shared/auth/controlled-route-check.ts',
      name: 'checkControlledRoute',
      category: 'AVAILABILITY-READ',
      guard: 'checkBetaCapability',
      reason:
        'Returns one capability decision for the route gate. The decision is the answer; the page’s server functions ask the policy for the data.',
    },
    {
      file: 'src/shared/observability/browser-observability.server.ts',
      name: 'getBrowserObservabilityConfigFn',
      category: 'PUBLIC',
      guard: null,
      reason:
        'The browser’s error-monitoring config (DSN, release, environment), needed before sign-in. It reads no tenant and no account.',
    },
  ]
