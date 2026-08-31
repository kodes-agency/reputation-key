import { describe, it, expect, vi } from 'vitest'
import {
  buildObservabilityConfig,
  createErrorMonitor,
  filterAndScrubSentryTransaction,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  type ErrorMonitoringSdk,
} from './telemetry'

function sdk() {
  const scope = {
    clear: vi.fn(),
    addEventProcessor: vi.fn(),
  }
  return {
    init: vi.fn<ErrorMonitoringSdk['init']>(),
    isInitialized: vi.fn<ErrorMonitoringSdk['isInitialized']>(() => false),
    setTags: vi.fn<ErrorMonitoringSdk['setTags']>(),
    captureException: vi.fn<ErrorMonitoringSdk['captureException']>(),
    captureFeedback: vi.fn<ErrorMonitoringSdk['captureFeedback']>(() => 'a'.repeat(32)),
    withScope: vi.fn<ErrorMonitoringSdk['withScope']>((callback) => callback(scope)),
    withIsolationScope: vi.fn<ErrorMonitoringSdk['withIsolationScope']>((callback) =>
      callback(scope),
    ),
    flush: vi.fn<ErrorMonitoringSdk['flush']>(async () => true),
  } satisfies ErrorMonitoringSdk
}

function logger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

describe('telemetry PII scrubbing (B3.5)', () => {
  it.each([
    '/health/live',
    '/health/ready',
    '/api/health/started',
    '/api/health/live',
    '/api/health/ready',
    '/api/health/metrics',
  ])('drops the operational probe transaction %s before Sentry delivery', (path) => {
    expect(
      filterAndScrubSentryTransaction({
        transaction: `GET ${path}`,
        request: { method: 'GET', url: `https://service.invalid${path}` },
      }),
    ).toBeNull()
  })

  it('retains and scrubs a non-health transaction', () => {
    expect(
      filterAndScrubSentryTransaction({
        transaction: 'GET /api/properties/tenant-secret',
        request: {
          method: 'GET',
          url: 'https://service.invalid/api/properties/tenant-secret?token=secret',
        },
      }),
    ).toEqual({
      transaction: '[REDACTED]',
      request: { method: 'GET' },
    })
  })

  it('redacts known PII fields', () => {
    const event = {
      message: 'Something happened',
      email: 'user@example.com',
      token: 'abc123',
      reviewText: 'Terrible service',
    }
    const scrubbed = scrubSentryEvent(event) as Record<string, unknown>

    expect(scrubbed.email).toBe('[REDACTED]')
    expect(scrubbed.token).toBe('[REDACTED]')
    expect(scrubbed.reviewText).toBe('[REDACTED]')
    expect(scrubbed.message).toBe('[REDACTED]')
  })

  it('redacts nested PII fields', () => {
    const event = {
      extra: {
        reviewerName: 'John Doe',
        context: {
          accessToken: 'secret-token',
        },
      },
    }
    const scrubbed = scrubSentryEvent(event) as Record<string, unknown>
    expect(scrubbed).not.toHaveProperty('extra')
  })

  it('uses the same normalized credential and personal-data vocabulary as logs', () => {
    const marker = 'marker-private-value'
    const scrubbed = scrubSentryEvent({
      password_hash: marker,
      clientSecret: marker,
      OPENAI_API_KEY: marker,
      contactEmail: marker,
      DATABASE_URL: `postgresql://user:${marker}@database/repkey`,
      outcomeCode: 'provider_rejected',
    }) as Record<string, unknown>

    expect(JSON.stringify(scrubbed)).not.toContain(marker)
    expect(scrubbed.outcomeCode).toBe('provider_rejected')
  })

  it('redacts PII in URL strings', () => {
    const event = {
      url: '/api/reviews/550e8400-e29b-41d4-a716-446655440000/reply',
      query: 'token=secret123&key=apiKey456',
    }
    const scrubbed = scrubSentryEvent(event) as Record<string, unknown>

    expect(scrubbed.url).not.toContain('550e8400')
    expect(scrubbed.query).not.toContain('secret123')
    expect(scrubbed.query).not.toContain('apiKey456')
  })

  it('redacts PII in arrays', () => {
    const event = {
      breadcrumbs: [
        { data: { email: 'a@b.com', action: 'click' } },
        { data: { token: 'xyz', action: 'navigate' } },
      ],
    }
    const scrubbed = scrubSentryEvent(event) as Record<string, unknown>
    const breadcrumbs = scrubbed.breadcrumbs as Array<Record<string, unknown>>

    expect(breadcrumbs[0]).toEqual({})
    expect(breadcrumbs[1]).toEqual({})
  })

  it('preserves non-PII data', () => {
    const event = {
      level: 'error',
      timestamp: 1784123456000,
      platform: 'node',
      tags: { queue: 'default', context: 'review' },
    }
    const scrubbed = scrubSentryEvent(event) as Record<string, unknown>

    expect(scrubbed.level).toBe('error')
    expect(scrubbed.platform).toBe('node')
    const tags = scrubbed.tags as Record<string, unknown>
    expect(tags.queue).toBe('default')
  })

  it('handles circular references without crashing', () => {
    const circular: Record<string, unknown> = {
      name: 'test',
      clientSecret: 'marker-private-value',
    }
    circular.self = circular
    const scrubbed = scrubSentryEvent(circular) as Record<string, unknown>

    expect(scrubbed.clientSecret).toBe('[REDACTED]')
    expect(scrubbed.self).toBe(scrubbed)
  })

  it('handles null and undefined', () => {
    expect(scrubSentryEvent(null)).toBeNull()
    expect(scrubSentryEvent(undefined)).toBeUndefined()
  })

  it('removes arbitrary exception messages, request content, user data, and extras', () => {
    const marker = 'seeded-private-review-and-contact'
    const scrubbed = scrubSentryEvent({
      message: marker,
      transaction: `/properties/${marker}/reviews`,
      exception: {
        values: [{ type: 'Error', value: marker, stacktrace: { frames: [] } }],
      },
      request: {
        method: 'POST',
        url: `https://eu.example.invalid/portal/${marker}?token=${marker}`,
        headers: { cookie: marker },
        cookies: { session: marker },
        data: { feedback: marker },
        query_string: `contact=${marker}`,
      },
      user: { id: marker, email: `${marker}@example.invalid` },
      extra: { arbitrary: marker },
      tags: { service: 'web', tenant_name: marker },
      contexts: {
        runtime: { name: 'node', version: '22.23.2', commandLine: marker },
        custom: { note: marker },
      },
      fingerprint: [marker],
      logentry: { formatted: marker },
      breadcrumbs: [{ category: 'http', message: marker, data: { body: marker } }],
    }) as Record<string, unknown>

    expect(JSON.stringify(scrubbed)).not.toContain(marker)
    expect(scrubbed.message).toBe('[REDACTED]')
    expect(scrubbed.transaction).toBe('[REDACTED]')
    expect(scrubbed.request).toEqual({ method: 'POST' })
    expect(scrubbed).not.toHaveProperty('user')
    expect(scrubbed).not.toHaveProperty('extra')
    expect(scrubbed).not.toHaveProperty('fingerprint')
    expect(scrubbed).not.toHaveProperty('logentry')
    expect(scrubbed.tags).toEqual({ service: 'web' })
    expect(scrubbed.contexts).toEqual({
      runtime: { name: 'node', version: '22.23.2' },
    })
  })

  it('keeps only non-content breadcrumb metadata', () => {
    expect(
      scrubSentryBreadcrumb({
        type: 'http',
        category: 'fetch',
        level: 'error',
        timestamp: 123,
        message: 'private review text',
        data: { url: '/portal/private-hotel', responseBody: 'private feedback' },
      }),
    ).toEqual({ type: 'http', category: 'fetch', level: 'error', timestamp: 123 })
  })

  it('preserves only the intentional feedback message and controlled tags', () => {
    const marker = 'private-review-marker'
    const scrubbed = scrubSentryEvent({
      type: 'feedback',
      contexts: {
        feedback: {
          message: `Expected the page to load. Contact a@b.example. token=${marker}`,
          source: 'repkey-native-beta-feedback',
          contact_email: 'manager@example.com',
          name: 'Manager Name',
          replay_id: marker,
          url: `/properties/${marker}`,
        },
        custom: { reviewText: marker },
      },
      tags: {
        service: 'web',
        feedback_type: 'bug',
        feedback_impact: 'blocking',
        feedback_route: 'properties.property.reviews',
        feedback_actor: 'b'.repeat(64),
        feedback_organization: 'c'.repeat(64),
        tenant_name: marker,
      },
      user: { email: 'manager@example.com' },
      extra: { reviewText: marker },
    }) as Record<string, unknown>

    expect(scrubbed).not.toHaveProperty('user')
    expect(scrubbed).not.toHaveProperty('extra')
    expect(scrubbed.contexts).toEqual({
      feedback: {
        message: 'Expected the page to load. Contact [REDACTED]. token=[REDACTED]',
        source: 'repkey-native-beta-feedback',
      },
    })
    expect(scrubbed.tags).toEqual({
      service: 'web',
      feedback_type: 'bug',
      feedback_impact: 'blocking',
      feedback_route: 'properties.property.reviews',
      feedback_actor: 'b'.repeat(64),
      feedback_organization: 'c'.repeat(64),
    })
    expect(JSON.stringify(scrubbed)).not.toContain(marker)
    expect(JSON.stringify(scrubbed)).not.toContain('manager@example.com')
  })
})

describe('error monitoring runtime', () => {
  const baseConfig = {
    service: 'worker' as const,
    dsn: 'https://public@o1.ingest.de.sentry.io/1',
    environment: 'cell-us',
    release: 'a'.repeat(40),
    processingCell: 'us',
    tracesSampleRate: 0.1,
  }

  it('initializes once with privacy hooks and stable deployment tags', () => {
    const sentry = sdk()
    const log = logger()
    const monitor = createErrorMonitor({ sentry, logger: log })

    expect(monitor.initialize(baseConfig)).toBe('enabled')
    expect(monitor.initialize(baseConfig)).toBe('enabled')

    expect(sentry.init).toHaveBeenCalledOnce()
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: baseConfig.dsn,
        environment: 'cell-us',
        release: baseConfig.release,
        tracesSampleRate: 0.1,
        sendDefaultPii: false,
        includeLocalVariables: false,
        serverName: 'repkey-worker',
        integrations: expect.any(Function),
        beforeSend: expect.any(Function),
        beforeSendTransaction: expect.any(Function),
        beforeBreadcrumb: expect.any(Function),
      }),
    )
    expect(sentry.setTags).toHaveBeenCalledWith({
      service: 'worker',
      processing_cell: 'us',
      release_sha: baseConfig.release,
    })
    const options = sentry.init.mock.calls[0]![0]
    expect(
      options.integrations([
        { name: 'Http' },
        { name: 'OnUncaughtException' },
        { name: 'OnUnhandledRejection' },
        { name: 'LocalVariablesAsync' },
        { name: 'ContextLines' },
        { name: 'Replay' },
        { name: 'ReplayCanvas' },
      ]),
    ).toEqual([{ name: 'Http' }])
  })

  it('captures native feedback only after monitoring is initialized', () => {
    const sentry = sdk()
    const monitor = createErrorMonitor({ sentry, logger: logger() })
    const feedback = {
      message: 'Bug report from manager@example.com with token=private',
      source: 'repkey-native-beta-feedback',
      tags: { feedback_type: 'bug', tenant_name: 'Private Tenant' },
    } as const

    expect(monitor.captureFeedback(feedback)).toBeUndefined()
    monitor.initialize(baseConfig)
    expect(monitor.captureFeedback(feedback)).toBe('a'.repeat(32))
    expect(sentry.withIsolationScope).toHaveBeenCalledTimes(1)
    expect(sentry.withScope).toHaveBeenCalledTimes(1)
    const capturedScope = sentry.captureFeedback.mock.calls[0]?.[2]
    expect(capturedScope).toBeDefined()
    if (!capturedScope) throw new Error('expected feedback capture scope')
    expect(capturedScope?.clear).toHaveBeenCalledTimes(2)
    expect(capturedScope?.addEventProcessor).toHaveBeenCalledWith(scrubSentryEvent)
    const processor = vi.mocked(capturedScope.addEventProcessor).mock.calls[0]?.[0]
    expect(
      processor?.({
        type: 'feedback',
        contexts: {
          feedback: {
            message: 'Useful report',
            source: 'repkey-native-beta-feedback',
          },
        },
        request: { headers: { cookie: 'private-session' } },
        breadcrumbs: [{ message: 'private-review' }],
        attachments: [{ filename: 'private.png' }],
      }),
    ).toEqual({
      type: 'feedback',
      contexts: {
        feedback: {
          message: 'Useful report',
          source: 'repkey-native-beta-feedback',
        },
      },
      tags: {},
    })
    expect(sentry.captureFeedback).toHaveBeenCalledWith(
      {
        message: 'Bug report from [REDACTED] with token=[REDACTED]',
        source: 'repkey-native-beta-feedback',
        tags: {
          service: 'worker',
          processing_cell: 'us',
          release_sha: 'a'.repeat(40),
          feedback_type: 'bug',
        },
      },
      { includeReplay: false },
      expect.objectContaining({
        clear: expect.any(Function),
        addEventProcessor: expect.any(Function),
      }),
    )
  })

  it('attaches only the server-rendered masked wireframe with a bounded expiry', () => {
    const sentry = sdk()
    const monitor = createErrorMonitor({ sentry, logger: logger() })
    monitor.initialize(baseConfig)

    expect(
      monitor.captureFeedback({
        message: 'The layout shifted.',
        source: 'repkey-native-beta-feedback',
        tags: {
          feedback_type: 'bug',
          feedback_attachment: 'masked_layout_v1',
          feedback_attachment_retention: '30d_max',
        },
        maskedLayoutAttachment: {
          capturedAt: '2026-08-28T08:00:00.000Z',
          expiresAt: '2026-09-27T08:00:00.000Z',
          snapshot: {
            profile: 'masked-layout-v1',
            consented: true,
            gridWidth: 64,
            gridHeight: 40,
            blocks: [{ kind: 'text', x: 4, y: 5, width: 20, height: 2 }],
          },
        },
      }),
    ).toBe('a'.repeat(32))

    const hint = sentry.captureFeedback.mock.calls[0]?.[1]
    expect(hint).toMatchObject({ includeReplay: false })
    expect(hint?.attachments).toHaveLength(1)
    const attachment = hint?.attachments?.[0]
    expect(attachment).toMatchObject({
      filename: 'repkey-masked-layout.svg',
      contentType: 'image/svg+xml',
    })
    const svg = new TextDecoder().decode(attachment?.data as Uint8Array)
    expect(svg).toContain('data-mask-kind="text"')
    expect(svg).not.toContain('The layout shifted')
    expect(svg).not.toContain('<text')
    expect(svg).not.toContain('<image')
  })

  it('refuses an attachment whose declared lifetime exceeds 30 days', () => {
    const sentry = sdk()
    const monitor = createErrorMonitor({ sentry, logger: logger() })
    monitor.initialize(baseConfig)

    expect(
      monitor.captureFeedback({
        message: 'The layout shifted.',
        source: 'repkey-native-beta-feedback',
        tags: { feedback_type: 'bug' },
        maskedLayoutAttachment: {
          capturedAt: '2026-08-28T08:00:00.000Z',
          expiresAt: '2026-09-27T08:00:00.001Z',
          snapshot: {
            profile: 'masked-layout-v1',
            consented: true,
            gridWidth: 64,
            gridHeight: 40,
            blocks: [{ kind: 'surface', x: 0, y: 0, width: 64, height: 40 }],
          },
        },
      }),
    ).toBeUndefined()
    expect(sentry.captureFeedback).not.toHaveBeenCalled()
  })

  it('binds to a preload-initialized SDK without initializing it twice', () => {
    const sentry = sdk()
    sentry.isInitialized.mockReturnValue(true)
    const monitor = createErrorMonitor({ sentry, logger: logger() })

    expect(monitor.initialize(baseConfig)).toBe('enabled')
    expect(sentry.init).not.toHaveBeenCalled()
    expect(sentry.setTags).toHaveBeenCalledOnce()
  })

  it('initializes even when the full application logger is not available yet', () => {
    const sentry = sdk()
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const monitor = createErrorMonitor({
      sentry,
      logger: () => {
        throw new Error('full application environment unavailable')
      },
    })

    expect(monitor.initialize(baseConfig)).toBe('enabled')
    expect(sentry.init).toHaveBeenCalledOnce()
    expect(stderr).toHaveBeenCalledWith(
      '[observability:info] Error monitoring initialized\n',
    )
    stderr.mockRestore()
  })

  it('retains the provider process-fatal integrations for the web process', () => {
    const sentry = sdk()
    const monitor = createErrorMonitor({ sentry, logger: logger() })
    monitor.initialize({ ...baseConfig, service: 'web' })
    const options = sentry.init.mock.calls[0]![0]

    expect(
      options.integrations([
        { name: 'OnUncaughtException' },
        { name: 'OnUnhandledRejection' },
        { name: 'LocalVariablesAsync' },
        { name: 'ContextLines' },
        { name: 'Replay' },
        { name: 'ReplayCanvas' },
      ]),
    ).toEqual([{ name: 'OnUncaughtException' }, { name: 'OnUnhandledRejection' }])
  })

  it.each([
    'google-execution-admission',
    'google-egress-gateway',
    'ai-execution-admission',
    'ai-egress-gateway',
  ] as const)(
    'supports Germany error monitoring for the %s process without competing fatal handlers',
    (service) => {
      const sentry = sdk()
      const monitor = createErrorMonitor({ sentry, logger: logger() })

      monitor.initialize({ ...baseConfig, service })
      monitor.captureException(new Error('provider payload must not be logged'), {
        source: 'sidecar-process',
        trigger: 'uncaughtException',
      })

      const options = sentry.init.mock.calls[0]![0]
      expect(options.serverName).toBe(`repkey-${service}`)
      expect(
        options.integrations([
          { name: 'Http' },
          { name: 'OnUncaughtException' },
          { name: 'OnUnhandledRejection' },
          { name: 'LocalVariablesAsync' },
          { name: 'ContextLines' },
          { name: 'Replay' },
          { name: 'ReplayCanvas' },
        ]),
      ).toEqual([{ name: 'Http' }])
      expect(sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
        tags: {
          runtime_source: 'sidecar-process',
          termination_trigger: 'uncaughtException',
        },
      })
    },
  )

  it('is disabled without a DSN and never loads or captures data', async () => {
    const sentry = sdk()
    const monitor = createErrorMonitor({ sentry, logger: logger() })

    expect(monitor.initialize({ ...baseConfig, dsn: undefined })).toBe('disabled')
    monitor.captureException(new Error('not sent'), { source: 'worker-startup' })

    expect(sentry.init).not.toHaveBeenCalled()
    expect(sentry.captureException).not.toHaveBeenCalled()
    await expect(monitor.flush(25)).resolves.toBe(true)
    expect(sentry.flush).not.toHaveBeenCalled()
  })

  it('never forwards a primitive rejection value to the provider', () => {
    const sentry = sdk()
    const monitor = createErrorMonitor({ sentry, logger: logger() })
    monitor.initialize(baseConfig)

    monitor.captureException('postgresql://user:secret@example.invalid/db', {
      source: 'worker-process',
      trigger: 'unhandledRejection',
    })

    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Non-Error failure' }),
      {
        tags: {
          runtime_source: 'worker-process',
          termination_trigger: 'unhandledRejection',
        },
      },
    )
    expect(JSON.stringify(sentry.captureException.mock.calls)).not.toContain('secret')
  })

  it('allows only bounded machine-readable queue and job tags', () => {
    const sentry = sdk()
    const monitor = createErrorMonitor({ sentry, logger: logger() })
    monitor.initialize(baseConfig)

    monitor.captureException(new Error('failed'), {
      source: 'bullmq-job',
      queue: 'background',
      jobName: 'retention-sweep',
    })
    monitor.captureException(new Error('failed'), {
      source: 'bullmq-job',
      queue: 'a private queue name',
      jobName: 'private/review/text',
    })

    expect(sentry.captureException).toHaveBeenNthCalledWith(1, expect.any(Error), {
      tags: {
        runtime_source: 'bullmq-job',
        queue: 'background',
        job_name: 'retention-sweep',
      },
    })
    expect(sentry.captureException).toHaveBeenNthCalledWith(2, expect.any(Error), {
      tags: {
        runtime_source: 'bullmq-job',
        queue: 'unknown',
        job_name: 'unknown',
      },
    })
  })

  it('fails open if provider initialization or flushing fails', async () => {
    const sentry = sdk()
    sentry.init.mockImplementation(() => {
      throw new Error('sdk unavailable')
    })
    sentry.flush.mockRejectedValue(new Error('network unavailable'))
    const log = logger()
    const monitor = createErrorMonitor({ sentry, logger: log })

    expect(monitor.initialize(baseConfig)).toBe('failed')
    expect(log.error).toHaveBeenCalledWith(
      { err: expect.any(Error), service: 'worker' },
      'Error monitoring initialization failed — application startup continues',
    )

    sentry.init.mockImplementation(() => undefined)
    const second = createErrorMonitor({ sentry, logger: log })
    second.initialize(baseConfig)
    await expect(second.flush(25)).resolves.toBe(false)
    expect(log.warn).toHaveBeenCalledWith(
      { err: expect.any(Error), timeoutMs: 25 },
      'Error monitoring flush failed',
    )
  })

  it('reports a bounded flush timeout without throwing into shutdown', async () => {
    const sentry = sdk()
    sentry.flush.mockResolvedValue(false)
    const log = logger()
    const monitor = createErrorMonitor({ sentry, logger: log })
    monitor.initialize(baseConfig)

    await expect(monitor.flush(25)).resolves.toBe(false)
    expect(log.warn).toHaveBeenCalledWith(
      { timeoutMs: 25 },
      'Error monitoring flush timed out before delivery completed',
    )
  })

  it('requires the Germany ingestion host and a DSN in a deployed production cell', () => {
    const deployed = {
      NODE_ENV: 'production' as const,
      PROCESSING_CELL: 'us',
      RAILWAY_ENVIRONMENT_NAME: 'cell-us',
      RELEASE_SHA: 'b'.repeat(40),
      RAILWAY_GIT_COMMIT_SHA: undefined,
      SENTRY_TRACES_SAMPLE_RATE: 0.1,
    }

    expect(() => buildObservabilityConfig('web', deployed)).toThrow(
      'SENTRY_DSN is required',
    )
    expect(() =>
      buildObservabilityConfig('web', {
        ...deployed,
        SENTRY_DSN: 'https://public@o1.ingest.sentry.io/1',
      }),
    ).toThrow('Germany ingestion host')
    expect(
      buildObservabilityConfig('ai-egress-gateway', {
        ...deployed,
        SENTRY_DSN: 'https://public@o1.ingest.de.sentry.io/1',
      }),
    ).toMatchObject({
      environment: 'cell-us',
      processingCell: 'us',
      release: 'b'.repeat(40),
      service: 'ai-egress-gateway',
    })
  })
})
