// Which of the authentication provider's own HTTP routes /api/auth/* serves.
//
// Better Auth mounts every endpoint of its core and of each plugin behind one
// handler. Its organization routes authorize with the library's own checks
// (membership, or the role table), never with the app's ExecutionPolicy (ADR
// 0033): any member reads every invitation row, any signed-in account creates
// an Organization, and an AccountAdmin updates one with no capability decision
// and none of the app's validation. A list of refused paths cannot keep up
// with that surface, so this is the reverse: a provider route is served only
// when it is named in ALLOWED_PROVIDER_ROUTES, with its method. Everything
// else under /api/auth/* is refused before the provider sees it. App-owned
// server functions call the provider in process and are not affected.
//
// To allow a route, show that the product needs it over HTTP and that it
// returns and changes nothing more than the caller already can through
// app-owned server functions; write that reason beside the entry.
//
// REFUSED_PROVIDER_ROUTES is every other route the configured provider
// exposes. Nothing depends on it to refuse; it exists so that each refusal is
// a decision. The colocated test enumerates the provider's endpoints and fails
// when one is on neither list, so a library upgrade or a new plugin cannot add
// surface that nobody looked at.

/** The provider's base path: Better Auth's default, and this route's own. */
const PROVIDER_BASE_PATH = '/api/auth'

/** A provider route: its method and its path after the base path. */
export type ProviderRoute = Readonly<{ method: 'GET' | 'POST'; path: string }>

export const ALLOWED_PROVIDER_ROUTES: ReadonlyArray<ProviderRoute> = [
  // The browser client's session read (authClient.useSession, in the header
  // and on the invitation confirm step). It returns the caller's own session
  // and user. The POST form is the provider's deferred refresh, which this
  // deployment does not enable, so only GET is served.
  { method: 'GET', path: '/get-session' },
  // Credential sign-in. The login form uses the app-owned signInUser, which
  // calls this same endpoint in process, so the route grants nothing more. It
  // stays for the e2e suite's sign-in (e2e/helpers/auth.ts) and is limited
  // twice: by this route and by the provider.
  { method: 'POST', path: '/sign-in/email' },
  // authClient.signOut (top bar, operator console, invitation confirm step).
  // It ends the caller's own session.
  { method: 'POST', path: '/sign-out' },
  // The reset form's first step (authClient.requestPasswordReset). Anonymous
  // by design; the answer is the same whether or not the address has an
  // account.
  { method: 'POST', path: '/request-password-reset' },
  // The link in the reset mail. It checks the token and redirects to
  // /reset-password with it; it changes nothing.
  { method: 'GET', path: '/reset-password/:token' },
  // The reset form's second step (authClient.resetPassword). The mailed token
  // is the credential, and consuming it revokes every session of the user.
  { method: 'POST', path: '/reset-password' },
  // The link in the verification mail. Only the app-owned
  // resendVerificationEmail sends that mail, in process.
  { method: 'GET', path: '/verify-email' },
]

export const REFUSED_PROVIDER_ROUTES: ReadonlyArray<ProviderRoute> = [
  // Organization reads. The first four answer any member of the Organization
  // with every invitation or member row; an invitation id is the only secret
  // invited registration asks for, and only an AccountAdmin may list
  // invitations (ADR 0033). The app reads all of these in process, behind the
  // execution policy.
  { method: 'GET', path: '/organization/list-invitations' },
  { method: 'GET', path: '/organization/get-full-organization' },
  { method: 'GET', path: '/organization/get-invitation' },
  { method: 'GET', path: '/organization/list-members' },
  { method: 'GET', path: '/organization/get-organization' },
  { method: 'GET', path: '/organization/list' },
  { method: 'GET', path: '/organization/list-user-invitations' },
  { method: 'GET', path: '/organization/get-active-member' },
  { method: 'GET', path: '/organization/get-active-member-role' },
  { method: 'POST', path: '/organization/has-permission' },
  // Answers whether any Organization holds a slug, across tenants.
  { method: 'POST', path: '/organization/check-slug' },
  // Organization writes: app-owned Identity commands are the only write path.
  // Organizations are operator-provisioned (ADR 0065), so `create` is also
  // refused by the provider itself (allowUserToCreateOrganization, auth.ts).
  // `update` skips the execution policy and the app's validation. `set-active`
  // is done in process by ensureActiveOrg and setActiveOrganization, which
  // hold an account to its one membership.
  { method: 'POST', path: '/organization/create' },
  { method: 'POST', path: '/organization/update' },
  { method: 'POST', path: '/organization/delete' },
  { method: 'POST', path: '/organization/set-active' },
  { method: 'POST', path: '/organization/invite-member' },
  { method: 'POST', path: '/organization/cancel-invitation' },
  { method: 'POST', path: '/organization/accept-invitation' },
  { method: 'POST', path: '/organization/reject-invitation' },
  { method: 'POST', path: '/organization/remove-member' },
  { method: 'POST', path: '/organization/update-member-role' },
  { method: 'POST', path: '/organization/leave' },
  // Self-service sign-up: an unauthenticated user-row write, and the beta
  // onboards by invitation only. Refused here rather than by clearing
  // emailAndPassword.enabled, which would also disable sign-in and reset.
  { method: 'POST', path: '/sign-up/email' },
  // Only the app-owned resendVerificationEmail enforces the per-address limit
  // (ADR 0062 §6); this route would let anyone mail any unverified address.
  { method: 'POST', path: '/send-verification-email' },
  // Account changes the app owns (changePasswordFn, the profile functions) or
  // does not offer (changing the address, deleting the account).
  { method: 'POST', path: '/change-password' },
  { method: 'POST', path: '/update-user' },
  { method: 'POST', path: '/change-email' },
  { method: 'POST', path: '/delete-user' },
  { method: 'GET', path: '/delete-user/callback' },
  // Session management with no caller over HTTP. `verify-password` is a
  // password oracle for a stolen session; step-up calls it in process.
  { method: 'POST', path: '/get-session' },
  { method: 'POST', path: '/update-session' },
  { method: 'GET', path: '/list-sessions' },
  { method: 'POST', path: '/revoke-session' },
  { method: 'POST', path: '/revoke-sessions' },
  { method: 'POST', path: '/revoke-other-sessions' },
  { method: 'POST', path: '/verify-password' },
  // Social sign-in and linked accounts. No social provider is configured, and
  // Google Business Profile OAuth has its own route
  // (routes/api/auth/google/callback.ts).
  { method: 'POST', path: '/sign-in/social' },
  { method: 'GET', path: '/callback/:id' },
  { method: 'POST', path: '/callback/:id' },
  { method: 'POST', path: '/link-social' },
  { method: 'GET', path: '/list-accounts' },
  { method: 'POST', path: '/unlink-account' },
  { method: 'POST', path: '/refresh-token' },
  { method: 'POST', path: '/get-access-token' },
  { method: 'GET', path: '/account-info' },
  // The provider's status and error pages. Nothing links to them.
  { method: 'GET', path: '/ok' },
  { method: 'GET', path: '/error' },
]

const PATH_PARAMETER_PREFIX = ':'

/**
 * Whether `path` is exactly this route's path. A `:name` segment stands for
 * one non-empty segment; nothing else is a pattern, so a prefix, a suffix, a
 * trailing slash or a different case never matches.
 */
function isRoutePath(routePath: string, path: string): boolean {
  if (!routePath.includes(PATH_PARAMETER_PREFIX)) return routePath === path
  const expected = routePath.split('/')
  const actual = path.split('/')
  return (
    expected.length === actual.length &&
    expected.every((segment, index) =>
      segment.startsWith(PATH_PARAMETER_PREFIX)
        ? (actual[index] ?? '') !== ''
        : segment === actual[index],
    )
  )
}

export type ProviderRequestDecision = Readonly<{
  allowed: boolean
  /**
   * The provider route the path names, as its pattern (never the value of a
   * path parameter, which can be a mailed token), or null when it names none.
   */
  route: string | null
}>

/** Decide one request to /api/auth/* by its method and exact path. */
export function classifyProviderRequest(
  method: string,
  pathname: string,
): ProviderRequestDecision {
  if (!pathname.startsWith(`${PROVIDER_BASE_PATH}/`)) {
    return { allowed: false, route: null }
  }
  const path = pathname.slice(PROVIDER_BASE_PATH.length)
  const allowed = ALLOWED_PROVIDER_ROUTES.find(
    (route) => route.method === method && isRoutePath(route.path, path),
  )
  if (allowed) return { allowed: true, route: allowed.path }
  const known = [...ALLOWED_PROVIDER_ROUTES, ...REFUSED_PROVIDER_ROUTES].find((route) =>
    isRoutePath(route.path, path),
  )
  return { allowed: false, route: known?.path ?? null }
}
