// What RepKey publishes about the Guest session identifier, held to the sweep.
//
// The Privacy Notice (docs/legal/privacy-notice.md, rendered at /privacy), the
// beta contract and the data inventory each say how long the identifier is
// kept. They are prose, so nothing else stops them drifting from the rules the
// retention sweep executes: version 2.0 of the notice gave 24 hours for a
// receipt the sweep keeps 30 days. The receipt retention, the horizon of the
// copy on the visit record and the per-run cap are read from the sweep and
// never restated, so changing one fails this test until the documents, and the
// notice version, change with it. The 24 hours of the session itself is a
// Guest domain rule, not a sweep rule, and is checked here as written.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_BATCHES_PER_RUN } from '#/shared/db/retention/execute-retention-rule'
import { RETENTION_RULES } from './retention-sweep.job'

const DAY_MS = 24 * 60 * 60 * 1000
const HOURS_PER_DAY = 24

/** The two receipt scopes whose key and payload carry the Guest session identifier. */
const GUEST_RECEIPT_SCOPES = ['guest_qualified_scan', 'guest_destination_action'] as const

function ruleHorizonDays(subject: string): number {
  const rule = RETENTION_RULES.find((candidate) => candidate.subject === subject)
  if (!rule) throw new Error(`No retention rule has the subject ${subject}`)
  if (rule.olderThanMs === undefined) {
    throw new Error(`The retention rule ${subject} is not stated in days`)
  }
  return rule.olderThanMs / DAY_MS
}

const RECEIPT_DAYS = ruleHorizonDays('idempotency_receipts')
const SESSION_MIRROR_DAYS = ruleHorizonDays('scan_events.guest_session_pseudonym')
/** The notice gives the horizon of the copy on the visit record in hours. */
const SESSION_MIRROR_HOURS = SESSION_MIRROR_DAYS * HOURS_PER_DAY

/** The notice's name for the session identifier copied onto the visit record. */
const DIAGNOSTIC_PSEUDONYM = 'Guest session diagnostic pseudonym'

type NoticeRetentionRow = Readonly<{ informationClass: string; horizon: string }>

/** The lines of section 6 of the Privacy Notice, the retention section. */
function noticeRetentionLines(notice: string): ReadonlyArray<string> {
  const start = notice.indexOf('## 6. Current retention posture')
  const end = notice.indexOf('## 7. ', start)
  if (start < 0 || end < 0) throw new Error('Privacy Notice section 6 was not found')
  return notice.slice(start, end).split('\n')
}

/** The rows of the retention table in section 6 of the Privacy Notice. */
function noticeRetentionRows(notice: string): ReadonlyArray<NoticeRetentionRow> {
  const HEADER_AND_DIVIDER_LINES = 2
  return noticeRetentionLines(notice)
    .filter((line) => line.startsWith('|'))
    .slice(HEADER_AND_DIVIDER_LINES)
    .map((line) => {
      const [, informationClass = '', horizon = ''] = line
        .split('|')
        .map((cell) => cell.trim())
      return { informationClass, horizon }
    })
}

/**
 * The sentences of section 6 outside its table. The notice is hard-wrapped, so
 * its line breaks are folded away first.
 */
function noticeRetentionSentences(notice: string): ReadonlyArray<string> {
  return noticeRetentionLines(notice)
    .filter((line) => !line.startsWith('|') && !line.startsWith('#'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=\.) /)
}

/** Section 9 of the Privacy Notice, its change record, with line breaks folded away. */
function noticeChanges(notice: string): string {
  const start = notice.indexOf('## 9. Changes and contact')
  if (start < 0) throw new Error('Privacy Notice section 9 was not found')
  return notice.slice(start).replace(/\s+/g, ' ')
}

/** The one line of the beta contract that states Guest retention as executed. */
function contractGuestRetention(contract: string): ReadonlyArray<string> {
  return contract
    .split('\n')
    .filter((line) => line.startsWith('- **Guest retention as the sweep executes it**'))
}

function captured(source: string, pattern: RegExp, what: string): string {
  const value = pattern.exec(source)?.[1]
  if (value === undefined) throw new Error(`${what} was not found`)
  return value
}

describe('published Guest session retention matches the retention sweep', () => {
  const notice = readFileSync('docs/legal/privacy-notice.md', 'utf8')
  const contract = readFileSync('docs/BETA.md', 'utf8')
  const inventory = readFileSync('docs/security/data-inventory.md', 'utf8')

  it('gives the receipt retention on every Privacy Notice row that names a Guest receipt', () => {
    const guestReceiptRows = noticeRetentionRows(notice).filter(
      ({ informationClass }) =>
        /guest/i.test(informationClass) && /receipt/i.test(informationClass),
    )

    expect(guestReceiptRows.map(({ horizon }) => horizon)).toEqual([
      expect.stringContaining(`${RECEIPT_DAYS} days`),
    ])
    expect(guestReceiptRows.map(({ horizon }) => horizon)).toEqual([
      expect.stringContaining('session identifier'),
    ])
  })

  it('keeps the Guest response session itself on a Privacy Notice row of its own', () => {
    const sessionRows = noticeRetentionRows(notice).filter(
      ({ informationClass }) => informationClass === 'Guest response session',
    )

    expect(sessionRows.map(({ horizon }) => horizon)).toEqual([
      expect.stringContaining('24 hours'),
    ])
  })

  it('says which copy the diagnostic pseudonym is and when the sweep removes it', () => {
    const pseudonymRows = noticeRetentionRows(notice).filter(
      ({ informationClass }) => informationClass === DIAGNOSTIC_PSEUDONYM,
    )
    // Without this sentence the row reads as a second, shorter promise about
    // the identifier the receipt row keeps for 30 days.
    const explanation = noticeRetentionSentences(notice).filter((sentence) =>
      sentence.includes(DIAGNOSTIC_PSEUDONYM),
    )

    expect(pseudonymRows.map(({ horizon }) => horizon)).toEqual([
      expect.stringContaining(`${SESSION_MIRROR_HOURS} hours`),
    ])
    expect(explanation).toEqual([expect.stringContaining('copy of the identifier')])
    expect(explanation).toEqual([
      expect.stringContaining(`once the visit is ${SESSION_MIRROR_HOURS} hours old`),
    ])
  })

  it('gives the receipt retention wherever the Privacy Notice prose states it', () => {
    const retentionProse = noticeRetentionSentences(notice).join(' ')

    expect(retentionProse).toContain(
      `kept for ${RECEIPT_DAYS} days from the visit or selection`,
    )
    expect(retentionProse).toContain(`During those ${RECEIPT_DAYS} days`)
    expect(noticeChanges(notice)).toContain(
      `keep the session identifier for ${RECEIPT_DAYS} days`,
    )
  })

  it('states both horizons of the session identifier in the beta contract', () => {
    const guestRetention = contractGuestRetention(contract)

    expect(guestRetention).toEqual([
      expect.stringContaining(`**${SESSION_MIRROR_DAYS} day**`),
    ])
    expect(guestRetention).toEqual([expect.stringContaining(`**${RECEIPT_DAYS} days**`)])
    for (const scope of GUEST_RECEIPT_SCOPES) {
      expect(guestRetention).toEqual([expect.stringContaining(`\`${scope}\``)])
    }
  })

  it('gives the daily sweep no delay bound that its per-run cap cannot keep', () => {
    const guestRetention = contractGuestRetention(contract)

    // One run stops a rule at the cap and a failed rule waits for a later run,
    // so "at most a day late" is not something the sweep guarantees.
    expect(guestRetention).toEqual([
      expect.stringContaining(
        `per-run cap (${DEFAULT_MAX_BATCHES_PER_RUN} batches a rule`,
      ),
    ])
    expect(guestRetention).toEqual([expect.not.stringContaining('by up to a day')])
  })

  it('lists both receipt scopes in the data inventory at the receipt retention', () => {
    for (const scope of GUEST_RECEIPT_SCOPES) {
      const rows = inventory
        .split('\n')
        .filter((line) => line.startsWith('|') && line.includes(`\`${scope}\``))

      expect(rows).toEqual([expect.stringContaining(`${RECEIPT_DAYS} days`)])
    }
  })

  it('shows one notice version and effective date, and the contract change log names them', () => {
    const version = captured(notice, /^\*\*Version:\*\* (\S+)$/m, 'The notice version')
    const effectiveDate = captured(
      notice,
      /^\*\*Effective date:\*\* (\d{4}-\d{2}-\d{2})$/m,
      'The notice effective date',
    )
    const changeLog = contract.slice(contract.indexOf('## 10. Change log'))

    expect(noticeChanges(notice)).toContain(
      `This notice takes effect on ${effectiveDate} and is version ${version}.`,
    )
    expect(changeLog).toContain(
      `Privacy Notice version ${version}, effective ${effectiveDate}`,
    )
  })
})
