import { createServerFn } from '@tanstack/react-start'
import { getReleaseSha } from '#/shared/config/env'
import { requestRuntimeConfig } from '#/shared/config/request-runtime-config'

export type BrowserObservabilityConfig = Readonly<{
  dsn: string
  release: string
  environment: string
}>

export const getBrowserObservabilityConfigFn = createServerFn({ method: 'GET' }).handler(
  (): BrowserObservabilityConfig | null => {
    const { env } = requestRuntimeConfig()
    if (!env.SENTRY_DSN) return null

    return {
      dsn: env.SENTRY_DSN,
      release: getReleaseSha(env),
      environment: env.RAILWAY_ENVIRONMENT_NAME ?? env.NODE_ENV,
    }
  },
)
