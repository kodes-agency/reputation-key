import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('production error-monitoring wiring', () => {
  it('keeps the Node SDK at runtime and the TanStack wrapper build-only', () => {
    const manifest = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    // Bundle the wrapper so its build-only uploader never enters the prod
    // dependency tree; keep @sentry/node external so the --import preload,
    // Nitro hook and Start middlewares share one SDK instance. That sharing is
    // what matters, so assert the two packages move TOGETHER at an exact
    // version rather than pinning a literal here — a literal only forces a
    // re-pin on every Sentry release and proves nothing about the pairing.
    const nodeSdk = manifest.dependencies?.['@sentry/node']
    const wrapper = manifest.devDependencies?.['@sentry/tanstackstart-react']
    expect(nodeSdk).toMatch(/^\d+\.\d+\.\d+$/u)
    expect(wrapper).toBe(nodeSdk)
    expect(manifest.dependencies?.['@sentry/tanstackstart-react']).toBeUndefined()
    expect(manifest.devDependencies?.['@sentry/node']).toBeUndefined()
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
    // One image serves web and worker, so the image CMD is the web server and
    // the worker's preload lives in the start command of every worker
    // deployment surface. Nothing else guarantees the worker gets it.
    const workerStart =
      'node --import ./dist-worker/worker-observability-preload.js dist-worker/index.js'
    const railwayWorker = JSON.parse(read('railway.worker.json')) as {
      deploy?: { startCommand?: string }
    }
    expect(railwayWorker.deploy?.startCommand).toBe(workerStart)
    expect(read('compose.local.yml')).toContain(
      './dist-worker/worker-observability-preload.js',
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

  it('defers the browser SDK until after the synchronous error buffer is installed', () => {
    const instrumentation = read('src/instrument.client.ts')
    const clientEntry = read('src/client.tsx')
    const router = read('src/router.tsx')
    const telemetry = read('src/shared/observability/telemetry.ts')
    const viteConfig = read('vite.config.ts')

    expect(instrumentation).toContain("from '#/shared/observability/sentry-event-scrub'")
    expect(instrumentation).toContain("import('@sentry/tanstackstart-react')")
    expect(instrumentation).not.toMatch(
      /^import(?!\s+type\b)[^;\n]*['"]@sentry\/tanstackstart-react['"]/mu,
    )
    expect(instrumentation).toContain(
      "from '#/shared/observability/browser-exception-capture'",
    )
    expect(router).toContain("from '#/shared/observability/browser-exception-capture'")
    expect(router).not.toContain("from '@sentry/tanstackstart-react'")
    expect(instrumentation).toContain('beforeSend: scrubSentryEvent')
    expect(instrumentation).toContain('beforeBreadcrumb: scrubSentryBreadcrumb')
    expect(viteConfig).toContain("'**/shared/observability/browser-exception-capture.ts'")
    expect(telemetry).toContain("from './sentry-event-scrub'")
    expect(telemetry).not.toContain('function scrubSentryEvent')
    expect(clientEntry.startsWith("import './instrument.client'\n")).toBe(true)
    // Monitoring fails open in the browser too: the module-level call must
    // swallow a failed SDK chunk instead of leaving an unhandled rejection,
    // which the e2e error gate would (correctly) report as a page error.
    expect(instrumentation).toContain(
      'void initializeBrowserObservability(document).catch(() => {})',
    )
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

  it('externalizes only the shared Node SDK from the server bundle', () => {
    const viteConfig = read('vite.config.ts')
    expect(viteConfig).toContain(String.raw`/^@sentry\/node(?:\/|$)/`)
    expect(viteConfig).not.toContain(String.raw`/^@sentry\//`)
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
