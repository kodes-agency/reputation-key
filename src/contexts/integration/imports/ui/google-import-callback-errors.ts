// The import route's search schema reads this list, and that schema loads with
// the first paint. It stays a module without imports so the route does not
// pull the import manager into the initial bundle.

/** The client-safe codes the Google OAuth callback sends back to the import page. */
export const CONNECTION_CALLBACK_ERRORS = [
  'denied',
  'connection_failed',
  'account_already_connected',
  'scope_not_granted',
] as const

export type ConnectionCallbackError = (typeof CONNECTION_CALLBACK_ERRORS)[number]
