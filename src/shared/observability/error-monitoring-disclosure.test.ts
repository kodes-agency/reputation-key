// What RepKey publishes about its error-monitoring provider, held to the code.
//
// The Privacy Notice (docs/legal/privacy-notice.md, rendered at /privacy) names
// the provider in the table of section 2. Versions 2.0 and 2.1 said of it "used
// only when a DSN is configured, and no DSN is configured today", while every
// deployed process refuses to start without one and beta feedback text is sent
// there. The notice is prose, so nothing else stops it drifting from the boot
// check again.
//
// The claims held here, each exercised on the code that enforces it:
//   - the provider is required and its region is the United States (the boot
//     check and the region guard);
//   - beta feedback text goes to it, minus an email address, at no more than
//     6,000 characters (the feedback seam and the feedback contract);
//   - an error message is replaced before a report leaves, unless the runtime
//     raised the error, which keeps its first line without what it quotes
//     (the scrubber);
//   - a browser sends the provider an error report when a page fails, a count
//     when it did not send a report, and no record of a page being opened (the
//     pinned browser SDK, started the way a page starts it, on a page that is
//     opened, navigated, hidden, failed and hidden again);
//   - the server's health report is left on and passes no scrubber (the
//     integrations the server SDK is started with);
//   - a masked Bug layout expires within 30 days, is deleted by the sweep and
//     is not handed to the provider (the layout expiry, the sweep rule and the
//     feedback seam).
//
// Every other claim of the notice about monitoring needs a reading by hand:
// what a server health report holds (an SDK default), the tags that accompany
// a feedback report, the kinds of server report, what a browser's own request
// shows the provider's servers, and what the provider keeps.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type * as SentrySdk from '@sentry/tanstackstart-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { initializeBrowserObservability } from '#/instrument.client'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import {
  betaFeedbackInputSchema,
  formatBetaFeedbackMessage,
} from '#/shared/beta-feedback-contract'
import { maskedLayoutExpiry } from '#/shared/beta-feedback-layout'
import { BETA_FEEDBACK_SCREENSHOT_MAX_BYTES } from '#/shared/beta-feedback-screenshot'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import {
  captureBrowserException,
  setBrowserExceptionCapture,
} from './browser-exception-capture'
import { scrubSentryEvent } from './sentry-event-scrub'
import {
  buildObservabilityConfig,
  createErrorMonitor,
  type ErrorMonitoringSdk,
  type FeedbackCaptureHint,
  type FeedbackCaptureParams,
} from './telemetry'

const PROVIDER = 'Sentry'
const US_DSN = 'https://public@o1.ingest.us.sentry.io/1'
const OTHER_REGION_DSN = 'https://public@o1.ingest.de.sentry.io/1'
const FEEDBACK_SOURCE = 'repkey-native-beta-feedback'
const DAY_MS = 24 * 60 * 60 * 1000

/** A deployed cell as the boot check sees it: production on a named Railway environment. */
const DEPLOYED_CELL = {
  NODE_ENV: 'production' as const,
  RAILWAY_ENVIRONMENT_NAME: 'closed-beta-v2',
  RELEASE_SHA: 'b'.repeat(40),
  SENTRY_TRACES_SAMPLE_RATE: 0.1,
}

/** The longest report text the notice says a Participant can send. */
const REPORT_TEXT_LIMIT = 6_000

/** The notice's name for the layout a Participant may attach to a Bug report. */
const LAYOUT_CLASS = 'Optional masked Bug layout'
const LAYOUT_TABLE = 'beta_feedback_masked_layouts'
/** The notice's name for a screenshot a Participant attaches to a report. */
const SCREENSHOT_CLASS = 'Screenshot attached to a beta feedback report'

/** The lines of the notice from one heading up to the next. */
function noticePart(
  notice: string,
  heading: string,
  nextHeading: string,
): ReadonlyArray<string> {
  const start = notice.indexOf(heading)
  const end = notice.indexOf(nextHeading, start)
  if (start < 0 || end < 0) {
    throw new Error(`The part of the Privacy Notice under "${heading}" was not found`)
  }
  return notice.slice(start, end).split('\n')
}

/** The part of section 2 that describes monitoring and lists the providers. */
function monitoringLines(notice: string): ReadonlyArray<string> {
  return noticePart(notice, '### Operational and monitoring information', '## 3. ')
}

/** The cells after the first of the one table row whose first cell is `name`. */
function tableRow(lines: ReadonlyArray<string>, name: string): ReadonlyArray<string> {
  const [row, ...others] = lines
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter(([, first]) => first === name)
  if (!row || others.length > 0) {
    throw new Error(`The table does not have exactly one "${name}" row`)
  }
  return row.slice(2)
}

/** The provider's row of the table in section 2. */
function providerRow(notice: string): Readonly<{ purpose: string; controls: string }> {
  const [purpose = '', controls = ''] = tableRow(monitoringLines(notice), PROVIDER)
  return { purpose, controls }
}

/** What the retention table of section 6 says of one information class. */
function retentionHorizon(notice: string, informationClass: string): string {
  const retention = noticePart(notice, '## 6. Current retention posture', '## 7. ')
  const [horizon = ''] = tableRow(retention, informationClass)
  return horizon
}

/**
 * The sentences of the monitoring part outside its table. The notice is
 * hard-wrapped, so its line breaks are folded away first.
 */
function monitoringProse(notice: string): string {
  return monitoringLines(notice)
    .filter((line) => !line.startsWith('|') && !line.startsWith('#'))
    .join(' ')
    .replace(/\s+/g, ' ')
}

/** Section 9 of the Privacy Notice, its change record, with line breaks folded away. */
function noticeChanges(notice: string): string {
  const start = notice.indexOf('## 9. Changes and contact')
  if (start < 0) throw new Error('Privacy Notice section 9 was not found')
  return notice.slice(start).replace(/\s+/g, ' ')
}

type ServerSdkOptions = Parameters<ErrorMonitoringSdk['init']>[0]
type SdkRecord = {
  feedback: FeedbackCaptureParams[]
  started: ServerSdkOptions[]
  hints?: FeedbackCaptureHint[]
}

/**
 * The monitoring SDK as the server uses it, recording what it is handed
 * instead of sending it.
 */
function recordingSdk(record: SdkRecord): ErrorMonitoringSdk {
  const scope = { clear: () => undefined, addEventProcessor: () => undefined }
  return {
    init: (options) => {
      record.started.push(options)
    },
    isInitialized: () => false,
    setTags: () => undefined,
    captureException: () => undefined,
    captureFeedback: (params, hint) => {
      record.feedback.push(params)
      if (hint) record.hints?.push(hint)
      return 'a'.repeat(32)
    },
    withScope: (callback) => callback(scope),
    withIsolationScope: (callback) => callback(scope),
    flush: () => Promise.resolve(true),
  }
}

const quietLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

/** A deployed web process's monitor, started on the recording SDK. */
function startedMonitor(record: SdkRecord) {
  const monitor = createErrorMonitor({
    sentry: recordingSdk(record),
    logger: quietLogger,
  })
  monitor.initialize({
    service: 'web',
    dsn: US_DSN,
    environment: DEPLOYED_CELL.RAILWAY_ENVIRONMENT_NAME,
    release: DEPLOYED_CELL.RELEASE_SHA,
    tracesSampleRate: DEPLOYED_CELL.SENTRY_TRACES_SAMPLE_RATE,
  })
  return monitor
}

/** What the SDK is handed when one report text goes through the feedback seam. */
function sentThroughFeedbackSeam(message: string): ReadonlyArray<FeedbackCaptureParams> {
  const record: SdkRecord = { feedback: [], started: [] }
  startedMonitor(record).captureFeedback({ message, source: FEEDBACK_SOURCE, tags: {} })
  return record.feedback
}

/** The names of the SDK integrations the server keeps out of the ones offered. */
function serverIntegrationsKept(offered: ReadonlyArray<string>): ReadonlyArray<string> {
  const record: SdkRecord = { feedback: [], started: [] }
  startedMonitor(record)
  return record.started.flatMap((options) =>
    options.integrations(offered.map((name) => ({ name }))).map(({ name }) => name ?? ''),
  )
}

// ── A page, as the pinned browser SDK meets it ─────────────────────

const PAGE_ORIGIN = 'https://repkey.invalid'
const PAGE_PATH = '/p/a-guest-portal-token'
const GUEST_USER_AGENT = 'Mozilla/5.0 (a guest phone)'
const PAGE_FAILURE = 'the guest wrote that the room was cold'
/** An upper bound: a flush resolves as soon as the SDK has handed everything over. */
const SETTLE_MS = 2_000

type BrowserSdk = Pick<typeof SentrySdk, 'captureException' | 'flush' | 'init'>

const browserBuildSchema = z.object({
  exports: z.object({
    '.': z.object({ browser: z.object({ import: z.string() }) }),
  }),
})

/**
 * The SDK build a page's bundle loads. The package serves it under the
 * `browser` export condition, which Node never selects, so the entry is read
 * from the package's own export map.
 */
async function pinnedBrowserSdk(): Promise<BrowserSdk> {
  const manifestPath = createRequire(import.meta.url).resolve(
    '@sentry/tanstackstart-react/package.json',
  )
  const manifest = browserBuildSchema.parse(
    JSON.parse(readFileSync(manifestPath, 'utf8')),
  )
  const entry = resolve(dirname(manifestPath), manifest.exports['.'].browser.import)
  return (await import(pathToFileURL(entry).href)) as BrowserSdk
}

/** One thing a browser hands its transport: the kind of report and what it holds. */
type SentReport = Readonly<{ kind: string; holds: unknown }>

const envelopeSchema = z.tuple([
  z.unknown(),
  z.array(z.tuple([z.object({ type: z.string() }), z.unknown()])),
])

/** The reports in one envelope, read as they go over the wire. */
function reportsIn(envelope: unknown): ReadonlyArray<SentReport> {
  const [, items] = envelopeSchema.parse(JSON.parse(JSON.stringify(envelope)))
  return items.map(([{ type }, holds]) => ({ kind: type, holds }))
}

type PageListener = () => void

/**
 * Globals the SDK's default integrations wrap in place. They are stubbed so the
 * wrapping ends with the test; the absent ones are skipped by the SDK.
 */
function wrappedBySdk() {
  return {
    console: { ...console },
    setTimeout,
    setInterval,
    fetch: undefined,
    EventTarget: undefined,
    onerror: undefined,
    onunhandledrejection: undefined,
  }
}

/**
 * What a browser gives the SDK of a page: its document with the monitoring
 * settings the root route renders, its address and history, and the events
 * the SDK listens for.
 */
function openPage() {
  const listeners = new Map<string, ReadonlyArray<PageListener>>()
  const whenIdle: PageListener[] = []
  const target = {
    addEventListener: (type: string, listener: PageListener): void => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    removeEventListener: (): void => undefined,
  }
  const settings: Readonly<Record<string, string>> = {
    'meta[name="repkey-sentry-dsn"]': US_DSN,
    'meta[name="repkey-sentry-release"]': DEPLOYED_CELL.RELEASE_SHA,
    'meta[name="repkey-sentry-environment"]': DEPLOYED_CELL.RAILWAY_ENVIRONMENT_NAME,
  }
  const document = {
    ...target,
    visibilityState: 'visible',
    querySelector: (selector: string) => {
      const content = settings[selector]
      return content === undefined ? null : { getAttribute: () => content }
    },
  }
  const history: Pick<History, 'pushState' | 'replaceState'> = {
    pushState: () => undefined,
    replaceState: () => undefined,
  }
  const page = {
    ...wrappedBySdk(),
    ...target,
    window: target,
    document,
    history,
    location: { href: `${PAGE_ORIGIN}${PAGE_PATH}`, origin: PAGE_ORIGIN },
    navigator: { userAgent: GUEST_USER_AGENT },
    requestIdleCallback: (callback: PageListener): void => {
      whenIdle.push(callback)
    },
  }
  for (const [name, value] of Object.entries(page)) vi.stubGlobal(name, value)

  return {
    document,
    /** The browser has nothing else to do: idle callbacks run. */
    comeToRest: (): void => whenIdle.splice(0).forEach((callback) => callback()),
    /** A client-side navigation, as the router makes it. */
    moveTo: (path: string): void => history.pushState({}, '', path),
    /** The tab is hidden or closed. */
    hide: (): void => {
      document.visibilityState = 'hidden'
      for (const listener of listeners.get('visibilitychange') ?? []) listener()
    },
  }
}

/**
 * Everything one page handed the provider's transport, in three stretches:
 * while it was opened, left idle, navigated and hidden; after it failed; and
 * after it held a report back and was hidden again. The SDK is the pinned one,
 * started by `initializeBrowserObservability` exactly as a page starts it.
 */
async function reportsFromOnePageVisit() {
  const page = openPage()
  const sent: SentReport[] = []
  const sdk = await pinnedBrowserSdk()
  const transport = () => ({
    send: (envelope: unknown) => {
      sent.push(...reportsIn(envelope))
      return Promise.resolve({ statusCode: 200 })
    },
    flush: () => Promise.resolve(true),
  })
  await initializeBrowserObservability(page.document, () =>
    Promise.resolve({
      captureException: sdk.captureException,
      init: (options) => sdk.init({ ...options, transport }),
    }),
  )

  page.comeToRest()
  page.moveTo(`${PAGE_PATH}/thanks`)
  page.hide()
  await sdk.flush(SETTLE_MS)
  const opened = [...sent]

  captureBrowserException(new Error(PAGE_FAILURE))
  await sdk.flush(SETTLE_MS)
  const failed = sent.slice(opened.length)

  // An expected refusal is a report the Service holds back.
  captureBrowserException(new ServerFunctionError('AuthError', 'x', 'unauthorized', 401))
  await sdk.flush(SETTLE_MS)
  page.hide()
  await sdk.flush(SETTLE_MS)
  const left = sent.slice(opened.length + failed.length)

  return { opened, failed, left }
}

const BUG_REPORT = {
  kind: 'bug',
  impact: 'small_issue',
  routePath: '/inbox',
  viewport: 'regular',
} as const

function feedbackReport(message: string) {
  return betaFeedbackInputSchema.safeParse({ ...BUG_REPORT, message })
}

describe('published error monitoring matches what a deployed cell does', () => {
  const notice = readFileSync('docs/legal/privacy-notice.md', 'utf8')
  const contract = readFileSync('docs/BETA.md', 'utf8')
  const prose = () => monitoringProse(notice)

  afterEach(() => {
    vi.unstubAllGlobals()
    setBrowserExceptionCapture()
  })

  it('says the provider is required, as the boot check of every deployed process enforces', () => {
    for (const service of ['web', 'worker'] as const) {
      expect(() => buildObservabilityConfig(service, DEPLOYED_CELL)).toThrow(
        'SENTRY_DSN is required for every deployed Railway production environment',
      )
    }

    const { controls } = providerRow(notice)
    expect(controls).toContain(
      'required: the deployed Service does not start unless it is configured',
    )
    expect(controls).not.toMatch(/no DSN is configured|only when a DSN is configured/)
    expect(prose()).toContain(
      'Its web and worker processes do not start unless error monitoring is configured',
    )
  })

  it('gives the one region a deployed cell accepts', () => {
    expect(() =>
      buildObservabilityConfig('web', { ...DEPLOYED_CELL, SENTRY_DSN: OTHER_REGION_DSN }),
    ).toThrow('SENTRY_DSN must use the Sentry US ingestion host')
    expect(
      buildObservabilityConfig('web', { ...DEPLOYED_CELL, SENTRY_DSN: US_DSN }),
    ).toMatchObject({ dsn: US_DSN })

    expect(providerRow(notice).controls).toMatch(/^United States;/)
    expect(prose()).toContain(
      "accept only the provider's United States ingestion service",
    )
  })

  it('says beta feedback text goes to the provider, with the one redaction the feedback seam applies', () => {
    const sent = sentThroughFeedbackSeam(
      'Maria Ivanova could not save. Write to maria@example.invalid',
    )

    // An address is removed; a name is not something the seam can recognise.
    expect(sent.map(({ message }) => message)).toEqual([
      'Maria Ivanova could not save. Write to [REDACTED]',
    ])
    const { purpose, controls } = providerRow(notice)
    expect(purpose).toBe('Error monitoring and beta feedback reports')
    expect(controls).toContain('and beta feedback reports')
    expect(prose()).toContain('It is sent to the error-monitoring provider')
    expect(prose()).not.toContain('held separately from application telemetry')
    expect(prose()).toContain('automatically removes email addresses')
    expect(prose()).toContain(
      'It cannot recognise other personal data, such as a name, so the rest is sent as written',
    )
  })

  it('states the report length the feedback contract accepts', () => {
    expect(feedbackReport('x'.repeat(REPORT_TEXT_LIMIT)).success).toBe(true)
    expect(feedbackReport('x'.repeat(REPORT_TEXT_LIMIT + 1)).success).toBe(false)

    expect(prose()).toContain(
      `of at most ${REPORT_TEXT_LIMIT.toLocaleString('en-US')} characters`,
    )
  })

  it('says an error message is replaced before a report leaves unless the runtime raised it, as the scrubber does', () => {
    const marker = 'the guest wrote that the room was cold'
    const scrubbed = scrubSentryEvent({
      message: marker,
      exception: {
        values: [
          { type: 'Error', value: marker },
          {
            type: 'TypeError',
            value: `Cannot read properties of undefined (reading '${marker}')`,
          },
          { type: 'TypeError', value: `x is undefined\n${marker}` },
        ],
      },
    })

    expect(scrubbed).toEqual({
      message: '[REDACTED]',
      exception: {
        values: [
          { type: 'Error', value: '[REDACTED]' },
          {
            type: 'TypeError',
            value: 'Cannot read properties of undefined (reading "…")',
          },
          { type: 'TypeError', value: 'x is undefined' },
        ],
      },
    })
    expect(prose()).toContain(
      'the text of an error message is replaced before a report is sent, unless the error is of a kind the browser or server software raises itself about the program',
    )
    expect(prose()).toContain(
      'after the Service removes anything in quotation marks, web addresses, file paths, email addresses, identifiers, keys, and numbers of four or more digits',
    )
  })

  it('says a browser sends the provider an error report when a page fails and no record of a page being opened, as a page started on the pinned SDK does', async () => {
    const visit = await reportsFromOnePageVisit()
    const everything = JSON.stringify(visit)

    // Opened, left idle, navigated and hidden: the provider is not contacted.
    // The SDK's own default is a session record for each page view, with the
    // browser's user-agent text.
    expect(visit.opened).toEqual([])
    // A failure: one error report, and what the scrubber leaves of it.
    expect(visit.failed).toEqual([
      {
        kind: 'event',
        holds: expect.objectContaining({
          exception: {
            values: [expect.objectContaining({ type: 'Error', value: '[REDACTED]' })],
          },
          release: DEPLOYED_CELL.RELEASE_SHA,
        }),
      },
    ])
    for (const personal of [PAGE_FAILURE, GUEST_USER_AGENT, PAGE_PATH]) {
      expect(everything).not.toContain(personal)
    }
    // A report held back, then the tab hidden again: a count by kind and
    // reason, and the time.
    expect(visit.left).toEqual([
      {
        kind: 'client_report',
        holds: {
          timestamp: expect.any(Number),
          discarded_events: [{ reason: 'before_send', category: 'error', quantity: 1 }],
        },
      },
    ])

    const { controls } = providerRow(notice)
    expect(controls).toContain('error reports from Participant and Guest browsers')
    expect(controls).not.toContain('page-load')
    expect(prose()).toContain(
      'sends the provider, directly, an error report when a page fails',
    )
    expect(prose()).toContain('It sends the provider no record of a page being opened')
    expect(prose()).toContain(
      'a count of those reports with their kind, the reason, and the time, and nothing else',
    )
    expect(prose()).not.toContain('page-load record')
  })

  it('claims minimization only for the reports the scrubber sees, not for the health report the server keeps on', () => {
    // The server's health report is the SDK's process session. It passes none
    // of the scrubber's callbacks, and the server's filter keeps it.
    expect(serverIntegrationsKept(['ProcessSession', 'Http', 'ContextLines'])).toEqual([
      'ProcessSession',
      'Http',
    ])

    expect(prose()).toContain(
      'Error reports, operational alerts, and timing reports are content-minimized as described above the table',
    )
    expect(prose()).toContain(
      'A server health report is sent as the monitoring software produces it',
    )
    expect(prose()).not.toContain('These reports are content-minimized')
  })

  it('gives the masked Bug layout the horizon, the clean-up and the keeper the code gives it', () => {
    const submittedAt = new Date('2026-10-13T09:00:00.000Z')
    const layoutDays =
      (maskedLayoutExpiry(submittedAt).getTime() - submittedAt.getTime()) / DAY_MS
    const report = betaFeedbackInputSchema.parse({
      ...BUG_REPORT,
      message: 'The layout broke.',
      maskedLayout: {
        width: 800,
        height: 600,
        boxes: [{ x: 13, y: 21, w: 340, h: 55, role: 'text' }],
      },
    })

    // The sweep deletes on the row's own deadline, with no horizon of its own.
    expect(RETENTION_RULES.filter(({ table }) => table === LAYOUT_TABLE)).toEqual([
      expect.objectContaining({ tsColumn: 'expires_at', olderThanMs: 0 }),
    ])
    // The seam hands the provider text and tags. Of the layout that text holds
    // the size and the block counts, never a rectangle.
    expect(sentThroughFeedbackSeam(formatBetaFeedbackMessage(report))).toEqual([
      {
        message: [
          'Type: Bug',
          'Impact: small_issue',
          'Route: inbox',
          'Message: The layout broke.',
          'Masked layout: 800x600 text=1',
        ].join('\n\n'),
        source: FEEDBACK_SOURCE,
        tags: { service: 'web', release_sha: DEPLOYED_CELL.RELEASE_SHA },
      },
    ])

    const horizon = retentionHorizon(notice, LAYOUT_CLASS)
    expect(horizon).toContain(
      `no later than ${layoutDays} days after the report is submitted`,
    )
    expect(horizon).toContain('then deleted by a daily clean-up')
    expect(horizon).toContain(
      "kept in the Service's own database and not sent to the error-monitoring provider",
    )
    expect(horizon).not.toMatch(/provider deletion|live proof/)
    expect(prose()).toContain('does not send the layout itself')
  })

  it('says a screenshot a Participant attaches goes to the provider as an image file of the report', () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const screenshot = {
      filename: 'screenshot.png',
      data: bytes,
      contentType: 'image/png',
    } as const
    const record: SdkRecord = { feedback: [], started: [], hints: [] }
    startedMonitor(record).captureFeedback({
      message: 'The total row is missing.',
      source: FEEDBACK_SOURCE,
      tags: {},
      attachments: [screenshot],
    })

    // A file of the report, beside its text and never inside it.
    expect(record.hints).toEqual([{ includeReplay: false, attachments: [screenshot] }])
    expect(record.feedback.map(({ message }) => message)).toEqual([
      'The total row is missing.',
    ])

    expect(providerRow(notice).controls).toContain(
      'and beta feedback reports with any screenshot a Participant attaches',
    )
    expect(prose()).toContain(
      'If the Participant attached a screenshot, the report carries it as an image file',
    )
    expect(prose()).toContain(
      `to at most ${BETA_FEEDBACK_SCREENSHOT_MAX_BYTES / 1024} KB`,
    )
    expect(prose()).toContain('without its text or its screenshot')
    const horizon = retentionHorizon(notice, SCREENSHOT_CLASS)
    expect(horizon).toContain('Not kept by the Service')
    expect(horizon).toContain('kept by the provider with it')
  })

  it('keeps the record of what version 2.4 changed, in the notice and in the beta contract', () => {
    expect(noticeChanges(notice)).toContain(
      'Version 2.4 changes what an error report says about the error',
    )
    expect(noticeChanges(notice)).toContain('every other error message is still replaced')
    expect(contract).toContain(
      'Privacy Notice version 2.4, effective 2026-10-16 on publication',
    )
  })

  it('keeps the record of what version 2.3 changed, in the notice and in the beta contract', () => {
    expect(noticeChanges(notice)).toContain(
      'Version 2.3 lets a Participant attach a screenshot to a beta feedback report',
    )
    expect(noticeChanges(notice)).toContain(
      'Nothing is sent unless a Participant attaches a screenshot to a report',
    )
    expect(contract).toContain(
      'Privacy Notice version 2.3, effective 2026-10-16 on publication',
    )
  })

  it('keeps the record of what version 2.2 corrected, in the notice and in the beta contract', () => {
    // Found by what the entry says, not by its date: other corrections can
    // carry the same day, and the publication day of this one can move.
    const corrections = contract
      .split('\n')
      .filter((line) => line.startsWith('- **CORRECTED'))

    expect(noticeChanges(notice)).toContain(
      'Version 2.2 corrects the provider table in section 2',
    )
    expect(noticeChanges(notice)).toContain(
      'the deployed Service does not start unless error monitoring is configured, and beta feedback text is sent to that provider',
    )
    expect(noticeChanges(notice)).toContain(
      'and the row for the optional masked Bug layout in section 6',
    )
    // Version 2.2 is published with one change to the Service, so its change
    // record may not say that nothing changes.
    expect(noticeChanges(notice)).toContain(
      'The Service published with version 2.2 no longer sends that record',
    )
    expect(noticeChanges(notice)).toContain(
      'the only change to what the Service does is that less is sent',
    )
    expect(noticeChanges(notice)).not.toContain(
      'version 2.2 corrects a description and changes nothing',
    )
    expect(corrections).toContainEqual(
      expect.stringContaining(
        'Privacy Notice version 2.2 says that the provider is required',
      ),
    )
    expect(corrections).toContainEqual(
      expect.stringContaining(
        'the browser SDK is started without its `BrowserSession` integration',
      ),
    )
    expect(corrections).toContainEqual(
      expect.stringContaining(
        'It also corrects the retention row for the optional masked Bug layout',
      ),
    )
  })
})
