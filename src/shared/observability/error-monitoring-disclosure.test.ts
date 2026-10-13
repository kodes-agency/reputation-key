// What RepKey publishes about its error-monitoring provider, held to the code.
//
// The Privacy Notice (docs/legal/privacy-notice.md, rendered at /privacy) names
// the provider in the table of section 2. Versions 2.0 and 2.1 said of it "used
// only when a DSN is configured, and no DSN is configured today", while every
// deployed process refuses to start without one and beta feedback text is sent
// there. The notice is prose, so nothing else stops it drifting from the boot
// check again. Each claim checked here is exercised on the code that enforces
// it: the boot check, the region guard, the feedback seam and the scrubber.
//
// Two claims of the notice are not held here because no repository code states
// them: what the browser SDK sends by default (the page-load record), and what
// the provider keeps. A change to either needs a reading of the notice by hand.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { betaFeedbackInputSchema } from '#/shared/beta-feedback-contract'
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

/** A deployed cell as the boot check sees it: production on a named Railway environment. */
const DEPLOYED_CELL = {
  NODE_ENV: 'production' as const,
  RAILWAY_ENVIRONMENT_NAME: 'closed-beta-v2',
  RELEASE_SHA: 'b'.repeat(40),
  SENTRY_TRACES_SAMPLE_RATE: 0.1,
}

/** The longest report text the notice says a Participant can send. */
const REPORT_TEXT_LIMIT = 6_000

type ProviderRow = Readonly<{ provider: string; purpose: string; controls: string }>

/** The part of section 2 that describes monitoring and lists the providers. */
function monitoringLines(notice: string): ReadonlyArray<string> {
  const start = notice.indexOf('### Operational and monitoring information')
  const end = notice.indexOf('## 3. ', start)
  if (start < 0 || end < 0) {
    throw new Error('The monitoring part of Privacy Notice section 2 was not found')
  }
  return notice.slice(start, end).split('\n')
}

/** The one row of the provider table that names the given provider. */
function providerRow(notice: string, provider: string): ProviderRow {
  const [row, ...others] = monitoringLines(notice)
    .filter((line) => line.startsWith('|'))
    .map((line) => {
      const [, name = '', purpose = '', controls = ''] = line
        .split('|')
        .map((cell) => cell.trim())
      return { provider: name, purpose, controls }
    })
    .filter((candidate) => candidate.provider === provider)
  if (!row || others.length > 0) {
    throw new Error(`The provider table does not have exactly one ${provider} row`)
  }
  return row
}

/**
 * The sentences of that part outside its table. The notice is hard-wrapped, so
 * its line breaks are folded away first.
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

/**
 * The monitoring SDK as the feedback seam uses it, recording what it is handed
 * instead of sending it.
 */
function recordingSdk(sent: FeedbackCaptureParams[]): ErrorMonitoringSdk {
  const scope = { clear: () => undefined, addEventProcessor: () => undefined }
  return {
    init: () => undefined,
    isInitialized: () => false,
    setTags: () => undefined,
    captureException: () => undefined,
    captureFeedback: (params) => {
      sent.push(params)
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

function feedbackReport(message: string) {
  return betaFeedbackInputSchema.safeParse({
    kind: 'bug',
    impact: 'small_issue',
    message,
    routePath: '/inbox',
    viewport: 'regular',
  })
}

describe('published error monitoring matches what a deployed cell does', () => {
  const notice = readFileSync('docs/legal/privacy-notice.md', 'utf8')
  const contract = readFileSync('docs/BETA.md', 'utf8')
  const row = providerRow(notice, PROVIDER)
  const prose = monitoringProse(notice)

  it('says the provider is required, as the boot check of every deployed process enforces', () => {
    for (const service of ['web', 'worker'] as const) {
      expect(() => buildObservabilityConfig(service, DEPLOYED_CELL)).toThrow(
        'SENTRY_DSN is required for every deployed Railway production environment',
      )
    }

    expect(row.controls).toContain(
      'required: the deployed Service does not start unless it is configured',
    )
    expect(row.controls).not.toMatch(/no DSN is configured|only when a DSN is configured/)
    expect(prose).toContain(
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

    expect(row.controls).toMatch(/^United States;/)
    expect(prose).toContain("accept only the provider's United States ingestion service")
  })

  it('says beta feedback text goes to the provider, with the one redaction the feedback seam applies', () => {
    const sent: FeedbackCaptureParams[] = []
    const monitor = createErrorMonitor({
      sentry: recordingSdk(sent),
      logger: quietLogger,
    })
    monitor.initialize({
      service: 'web',
      dsn: US_DSN,
      environment: DEPLOYED_CELL.RAILWAY_ENVIRONMENT_NAME,
      release: DEPLOYED_CELL.RELEASE_SHA,
      tracesSampleRate: DEPLOYED_CELL.SENTRY_TRACES_SAMPLE_RATE,
    })

    monitor.captureFeedback({
      message: 'Maria Ivanova could not save. Write to maria@example.invalid',
      source: 'repkey-native-beta-feedback',
      tags: {},
    })

    // An address is removed; a name is not something the seam can recognise.
    expect(sent.map(({ message }) => message)).toEqual([
      'Maria Ivanova could not save. Write to [REDACTED]',
    ])
    expect(row.purpose).toBe('Error monitoring and beta feedback reports')
    expect(row.controls).toContain('and beta feedback reports')
    expect(prose).toContain('It is sent to the error-monitoring provider')
    expect(prose).not.toContain('held separately from application telemetry')
    expect(prose).toContain('automatically removes email addresses')
    expect(prose).toContain(
      'It cannot recognise other personal data, such as a name, so the rest is sent as written',
    )
  })

  it('states the report length the feedback contract accepts', () => {
    expect(feedbackReport('x'.repeat(REPORT_TEXT_LIMIT)).success).toBe(true)
    expect(feedbackReport('x'.repeat(REPORT_TEXT_LIMIT + 1)).success).toBe(false)

    expect(prose).toContain(
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
    expect(prose).toContain(
      'the text of an error message is replaced before a report is sent',
    )
  })

  it('keeps the record of what version 2.2 corrected, in the notice and in the beta contract', () => {
    const corrections = contract
      .split('\n')
      .filter((line) => line.startsWith('- **CORRECTED 2026-10-13'))

    expect(noticeChanges(notice)).toContain(
      'Version 2.2 corrects the provider table in section 2',
    )
    expect(noticeChanges(notice)).toContain(
      'the deployed Service does not start unless error monitoring is configured, and beta feedback text is sent to that provider',
    )
    expect(corrections).toEqual([expect.stringContaining('Privacy Notice version 2.2')])
  })
})
