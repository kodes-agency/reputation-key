import { createServerFn } from '@tanstack/react-start'
import { getReleaseSha } from '#/shared/config/env'
import { requestRuntimeConfig } from '#/shared/config/request-runtime-config'

export type BrowserObservabilityConfig = Readonly<{
  dsn: string
  release: string
  environment: string
}>

type BrowserObservabilityEnvironment = Readonly<{
  SENTRY_DSN?: string
  RAILWAY_ENVIRONMENT_NAME?: string
  NODE_ENV: string
}>

export function resolveBrowserObservabilityConfig(
  env: BrowserObservabilityEnvironment,
  release: string,
): BrowserObservabilityConfig | null {
  if (!env.SENTRY_DSN) return null

  return {
    dsn: env.SENTRY_DSN,
    release,
    environment: env.RAILWAY_ENVIRONMENT_NAME ?? env.NODE_ENV,
  }
}

/**
 * What the root route writes into the page head.
 *
 * The release goes out whether or not monitoring is configured: the page keeps
 * it to tell when the server has moved on (stale-tab/), which must not depend on
 * a Sentry DSN being set.
 */
export type BrowserRuntimeConfig = Readonly<{
  release: string
  observability: BrowserObservabilityConfig | null
}>

export function resolveBrowserRuntimeConfig(
  env: BrowserObservabilityEnvironment,
  release: string,
): BrowserRuntimeConfig {
  return { release, observability: resolveBrowserObservabilityConfig(env, release) }
}

export const getBrowserObservabilityConfigFn = createServerFn({ method: 'GET' }).handler(
  (): BrowserRuntimeConfig => {
    const { env } = requestRuntimeConfig()
    return resolveBrowserRuntimeConfig(env, getReleaseSha(env))
  },
)
