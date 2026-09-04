import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('production error-monitoring wiring', () => {
  it('pins both Node and TanStack Start SDKs as direct runtime dependencies', () => {
    const manifest = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>
    }
    expect(manifest.dependencies?.['@sentry/node']).toBe('10.71.0')
    expect(manifest.dependencies?.['@sentry/tanstackstart-react']).toBe('10.71.0')
  })

  it('preloads monitoring before both production application entries', () => {
    const workerTsup = read('tsup.config.ts')
    const webTsup = read('tsup.web-observability.config.ts')
    expect(webTsup).toContain("'web-observability-preload'")
    expect(workerTsup).toContain("'worker-observability-preload'")
    expect(workerTsup).not.toContain("'web-observability-preload'")

    expect(read('Dockerfile')).toContain(
      'CMD ["node", "--import", "./.output/server/web-observability-preload.mjs", ".output/server/index.mjs"]',
    )
    expect(read('Dockerfile.worker')).toContain(
      'CMD ["node", "--import", "./dist-worker/worker-observability-preload.js", "dist-worker/index.js"]',
    )

    const manifest = JSON.parse(read('package.json')) as {
      scripts?: Record<string, string>
    }
    expect(manifest.scripts?.build).toContain('tsup.web-observability.config.ts')
    expect(manifest.scripts?.start).toContain('web-observability-preload.mjs')
    expect(manifest.scripts?.['start:worker']).toContain(
      'worker-observability-preload.js',
    )
    expect(read('scripts/check-security-headers.mjs')).toContain(
      "const PRELOAD_ENTRY = join(ROOT, '.output/server/web-observability-preload.mjs')",
    )
  })

  it('initializes the browser SDK before hydration through the shared scrubber', () => {
    const instrumentation = read('src/instrument.client.ts')
    const clientEntry = read('src/client.tsx')
    const telemetry = read('src/shared/observability/telemetry.ts')

    expect(instrumentation).toContain("from '#/shared/observability/sentry-event-scrub'")
    expect(instrumentation).toContain('beforeSend: scrubSentryEvent')
    expect(instrumentation).toContain('beforeBreadcrumb: scrubSentryBreadcrumb')
    expect(telemetry).toContain("from './sentry-event-scrub'")
    expect(telemetry).not.toContain('function scrubSentryEvent')
    expect(clientEntry.startsWith("import './instrument.client'\n")).toBe(true)
  })

  it('runs Sentry request and function middleware before application middleware', () => {
    const start = read('src/start.ts')
    const requestMiddleware = start.slice(start.indexOf('requestMiddleware:'))

    expect(requestMiddleware.indexOf('sentryGlobalRequestMiddleware')).toBeGreaterThan(-1)
    expect(requestMiddleware.indexOf('csrfMiddleware')).toBeGreaterThan(
      requestMiddleware.indexOf('sentryGlobalRequestMiddleware'),
    )
    expect(start).toContain('functionMiddleware: [sentryGlobalFunctionMiddleware]')
  })

  it('registers the Nitro error hook before graceful shutdown', () => {
    const viteConfig = read('vite.config.ts')
    const monitoringIndex = viteConfig.indexOf('server/plugins/error-monitoring.ts')
    const shutdownIndex = viteConfig.indexOf('server/plugins/graceful-shutdown.ts')
    expect(monitoringIndex).toBeGreaterThan(-1)
    expect(shutdownIndex).toBeGreaterThan(monitoringIndex)
  })

  it('captures worker startup/process failures and flushes before exit', () => {
    const worker = read('src/worker/index.ts')
    expect(worker).toContain("initObservability('worker')")
    expect(worker).toContain('captureObservabilityException')
    expect(worker).toContain('flushObservability')
  })

  it('keeps monitoring mandatory in Railway cells with no disable switch', () => {
    const railway = read('.railway/railway.ts')
    expect(railway).toContain("'SENTRY_DSN'")
    expect(railway).toContain("'SENTRY_TRACES_SAMPLE_RATE'")
    expect(railway).not.toContain('SENTRY_ENABLED')
  })
})
