import { describe, it, expect, vi } from 'vitest'
import {
  buildObservabilityConfig,
  createErrorMonitor,
  type ErrorMonitoringSdk,
} from './telemetry'
import { scrubSentryEvent } from './sentry-event-scrub'

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

describe('error monitoring runtime', () => {
  const baseConfig = {
    service: 'worker' as const,
    dsn: 'https://public@o1.ingest.us.sentry.io/1',
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

  it('retains the SDK process-fatal integrations for the web process', () => {
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

  it('records alert dispatcher captures under their dedicated runtime source', () => {
    const sentry = sdk()
    const monitor = createErrorMonitor({ sentry, logger: logger() })
    monitor.initialize(baseConfig)

    monitor.captureException(new Error('P1 alert fired'), {
      source: 'alert-dispatcher',
    })

    expect(sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { runtime_source: 'alert-dispatcher' },
    })
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

  it('requires the US ingestion host and a DSN in a Railway production environment', () => {
    const deployed = {
      NODE_ENV: 'production' as const,
      PROCESSING_CELL: 'us',
      RAILWAY_ENVIRONMENT_NAME: 'google-closed-beta',
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
    ).toThrow('US ingestion host')
    // A DSN from another Sentry region is refused, not silently shipped there.
    expect(() =>
      buildObservabilityConfig('web', {
        ...deployed,
        SENTRY_DSN: 'https://public@o1.ingest.de.sentry.io/1',
      }),
    ).toThrow('US ingestion host')
    expect(
      buildObservabilityConfig('worker', {
        ...deployed,
        SENTRY_DSN: 'https://public@o1.ingest.us.sentry.io/1',
      }),
    ).toMatchObject({
      environment: 'google-closed-beta',
      processingCell: 'us',
      release: 'b'.repeat(40),
      service: 'worker',
    })
  })

  it('covers legacy Railway production names without the cell prefix', () => {
    expect(() =>
      buildObservabilityConfig('worker', {
        NODE_ENV: 'production',
        PROCESSING_CELL: 'eu',
        RAILWAY_ENVIRONMENT_NAME: 'legacy-production',
        RELEASE_SHA: 'c'.repeat(40),
        RAILWAY_GIT_COMMIT_SHA: undefined,
        SENTRY_TRACES_SAMPLE_RATE: 0.1,
      }),
    ).toThrow('SENTRY_DSN is required')
  })
})
