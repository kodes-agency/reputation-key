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
//   - an error message is replaced before a report leaves (the scrubber);
//   - the SDK's own session records are left on and pass no scrubber (the
//     options both SDKs are started with);
//   - a masked Bug layout expires within 30 days, is deleted by the sweep and
//     is not handed to the provider (the layout expiry, the sweep rule and the
//     feedback seam).
//
// Every other claim of the notice about monitoring needs a reading by hand:
// what a session record holds (an SDK default), the tags that accompany a
// feedback report, the kinds of server report, and what the provider keeps.

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeBrowserObservability } from '#/instrument.client'
import {
  betaFeedbackInputSchema,
  formatBetaFeedbackMessage,
} from '#/shared/beta-feedback-contract'
import { maskedLayoutExpiry } from '#/shared/beta-feedback-layout'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import { scrubSentryEvent } from './sentry-event-scrub'
import {
  buildObservabilityConfig,
  createErrorMonitor,
  type ErrorMonitoringSdk,
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

/** What the retention table of section 6 says of the masked Bug layout. */
function layoutRetention(notice: string): string {
  const retention = noticePart(notice, '## 6. Current retention posture', '## 7. ')
  const [horizon = ''] = tableRow(retention, LAYOUT_CLASS)
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
type SdkRecord = { feedback: FeedbackCaptureParams[]; started: ServerSdkOptions[] }

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
    captureFeedback: (params) => {
      record.feedback.push(params)
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

/** The names of the options the browser SDK is started with on a page that has a DSN. */
async function browserSdkOptionNames(): Promise<ReadonlyArray<string>> {
  const started: object[] = []
  vi.stubGlobal('window', {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })
  await initializeBrowserObservability(
    {
      querySelector: (selector) =>
        selector === 'meta[name="repkey-sentry-dsn"]'
          ? { getAttribute: () => US_DSN }
          : null,
    },
    () =>
      Promise.resolve({
        init: (options?: object) => {
          started.push(options ?? {})
          return undefined
        },
        captureException: () => 'a'.repeat(32),
      }),
  )
  return started.flatMap((options) => Object.keys(options))
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

  afterEach(() => vi.unstubAllGlobals())

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

  it('says an error message is replaced before a report leaves, as the scrubber does', () => {
    const marker = 'the guest wrote that the room was cold'
    const scrubbed = scrubSentryEvent({
      message: marker,
      exception: { values: [{ type: 'Error', value: marker }] },
    })

    expect(scrubbed).toEqual({
      message: '[REDACTED]',
      exception: { values: [{ type: 'Error', value: '[REDACTED]' }] },
    })
    expect(prose()).toContain(
      'the text of an error message is replaced before a report is sent',
    )
  })

  it('claims minimization only for the reports the scrubber sees, not for the session records both SDKs keep on', async () => {
    // A session record (the browser's page-load record, the server's health
    // report) passes none of these callbacks, and neither SDK is told to stop
    // sending it: the browser is started on the SDK's default integrations and
    // the server's filter keeps the process session.
    expect(await browserSdkOptionNames()).toEqual([
      'dsn',
      'release',
      'environment',
      'sendDefaultPii',
      'tracesSampleRate',
      'beforeSend',
      'beforeBreadcrumb',
    ])
    expect(serverIntegrationsKept(['ProcessSession', 'Http', 'ContextLines'])).toEqual([
      'ProcessSession',
      'Http',
    ])

    expect(prose()).toContain(
      'Error reports, operational alerts, and timing reports are content-minimized as described above the table',
    )
    expect(prose()).toContain(
      'A page-load record and a server health report are sent as the monitoring software produces them',
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

    const horizon = layoutRetention(notice)
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
    expect(corrections).toContainEqual(
      expect.stringContaining(
        'Privacy Notice version 2.2 says that the provider is required',
      ),
    )
    expect(corrections).toContainEqual(
      expect.stringContaining(
        'It also corrects the retention row for the optional masked Bug layout',
      ),
    )
  })
})
