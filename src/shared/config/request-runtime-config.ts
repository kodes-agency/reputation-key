// Request entry-point runtime configuration.
//
// ARC-03-T14. HTTP route handlers are the one class of entry point that has no
// Application Container in hand at the moment it runs: they are reached by the
// framework, not composed. Before this module, seven route files each called
// `getEnv()` directly, so "which configuration does the request edge depend on"
// had no answer short of grepping.
//
// This is the ONE named owner of that read. It exposes exactly the values the
// request edge needs and nothing else, so adding a dependency is a visible edit
// here rather than an invisible one in a route.
//
// It is deliberately a function, not a module-level constant: reading at module
// load would bind configuration to import order and break process fixtures that
// set a deterministic environment before importing a route.

import { getEnv, type Env } from './env'

export type RequestRuntimeConfig = Readonly<{
  /**
   * The whole parsed configuration, for the three handlers that legitimately
   * need many values at once (the auth catch-all, the Google OAuth callback and
   * the GBP push webhook). They go through this owner so the request edge still
   * has exactly ONE ambient read site.
   */
  env: Env
  /** Auth catch-all: the deployment's canonical origin and environment. */
  nodeEnv: string
  betterAuthUrl: string
  /** Bearer token gating the operator metrics endpoint. Absent = endpoint closed. */
  opsMetricsToken: string | undefined
  /** Keyring for one-click unsubscribe links. */
  notificationUnsubscribeHmacKeys: string | undefined
  /** Provider webhook signing secret (Resend delivery events). */
  resendWebhookSecret: string | undefined
}>

export function requestRuntimeConfig(): RequestRuntimeConfig {
  const env = getEnv()
  return Object.freeze({
    env,
    nodeEnv: env.NODE_ENV,
    betterAuthUrl: env.BETTER_AUTH_URL,
    opsMetricsToken: env.OPS_METRICS_TOKEN,
    notificationUnsubscribeHmacKeys: env.NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS,
    resendWebhookSecret: env.RESEND_WEBHOOK_SECRET,
  })
}
