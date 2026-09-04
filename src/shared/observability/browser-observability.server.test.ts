import { describe, expect, it } from 'vitest'
import { resolveBrowserObservabilityConfig } from './browser-observability.server'

const RELEASE = 'a'.repeat(40)

describe('browser observability config', () => {
  it('returns null when no browser DSN is configured', () => {
    expect(
      resolveBrowserObservabilityConfig(
        {
          NODE_ENV: 'development',
          RAILWAY_ENVIRONMENT_NAME: 'local',
        },
        RELEASE,
      ),
    ).toBeNull()
  })

  it('returns the public browser config from the runtime environment', () => {
    const dsn = 'https://public@o1.ingest.us.sentry.io/1'

    expect(
      resolveBrowserObservabilityConfig(
        {
          SENTRY_DSN: dsn,
          NODE_ENV: 'production',
          RAILWAY_ENVIRONMENT_NAME: 'google-closed-beta',
        },
        RELEASE,
      ),
    ).toEqual({
      dsn,
      release: RELEASE,
      environment: 'google-closed-beta',
    })
  })

  it('does not silently reshape a non-US DSN', () => {
    const dsn = 'https://public@o1.ingest.de.sentry.io/1'

    expect(
      resolveBrowserObservabilityConfig(
        {
          SENTRY_DSN: dsn,
          NODE_ENV: 'test',
        },
        RELEASE,
      ),
    ).toEqual({ dsn, release: RELEASE, environment: 'test' })
  })
})
