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

export const getBrowserObservabilityConfigFn = createServerFn({ method: 'GET' }).handler(
  (): BrowserObservabilityConfig | null => {
    const { env } = requestRuntimeConfig()
    return resolveBrowserObservabilityConfig(env, getReleaseSha(env))
  },
)
