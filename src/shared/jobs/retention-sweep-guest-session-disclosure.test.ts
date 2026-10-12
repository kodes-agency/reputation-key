// What RepKey publishes about the Guest session identifier, held to the sweep.
//
// The Privacy Notice (docs/legal/privacy-notice.md, rendered at /privacy), the
// beta contract and the data inventory each say how long the identifier is
// kept. They are prose, so nothing else stops them drifting from the rules the
// retention sweep executes: version 2.0 of the notice gave 24 hours for a
// receipt the sweep keeps 30 days. The figures below are read from
// RETENTION_RULES and never restated, so changing a rule fails this test until
// the documents, and the notice version, change with it.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RETENTION_RULES } from './retention-sweep.job'

const DAY_MS = 24 * 60 * 60 * 1000

/** The two receipt scopes whose key and payload carry the Guest session identifier. */
const GUEST_RECEIPT_SCOPES = ['guest_qualified_scan', 'guest_destination_action'] as const

function ruleHorizonDays(subject: string): number {
  const rule = RETENTION_RULES.find((candidate) => candidate.subject === subject)
  if (!rule) throw new Error(`No retention rule has the subject ${subject}`)
  return rule.olderThanMs / DAY_MS
}

const RECEIPT_DAYS = ruleHorizonDays('idempotency_receipts')
const SESSION_MIRROR_DAYS = ruleHorizonDays('scan_events.guest_session_pseudonym')

type NoticeRetentionRow = Readonly<{ informationClass: string; horizon: string }>

/** The rows of the retention table in section 6 of the Privacy Notice. */
function noticeRetentionRows(notice: string): ReadonlyArray<NoticeRetentionRow> {
  const start = notice.indexOf('## 6. Current retention posture')
  const end = notice.indexOf('## 7. ', start)
  if (start < 0 || end < 0) throw new Error('Privacy Notice section 6 was not found')
  const HEADER_AND_DIVIDER_LINES = 2
  return notice
    .slice(start, end)
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(HEADER_AND_DIVIDER_LINES)
    .map((line) => {
      const [, informationClass = '', horizon = ''] = line
        .split('|')
        .map((cell) => cell.trim())
      return { informationClass, horizon }
    })
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

  it('states both horizons of the session identifier in the beta contract', () => {
    const guestRetention = contract
      .split('\n')
      .filter((line) => line.startsWith('- **Guest retention as the sweep executes it**'))

    expect(guestRetention).toEqual([
      expect.stringContaining(`**${SESSION_MIRROR_DAYS} day**`),
    ])
    expect(guestRetention).toEqual([expect.stringContaining(`**${RECEIPT_DAYS} days**`)])
    for (const scope of GUEST_RECEIPT_SCOPES) {
      expect(guestRetention).toEqual([expect.stringContaining(`\`${scope}\``)])
    }
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
    // The notice is hard-wrapped, so compare with its line breaks folded away.
    const changes = notice
      .slice(notice.indexOf('## 9. Changes and contact'))
      .replace(/\s+/g, ' ')
    const changeLog = contract.slice(contract.indexOf('## 10. Change log'))

    expect(changes).toContain(
      `This notice takes effect on ${effectiveDate} and is version ${version}.`,
    )
    expect(changeLog).toContain(
      `Privacy Notice version ${version}, effective ${effectiveDate}`,
    )
  })
})
