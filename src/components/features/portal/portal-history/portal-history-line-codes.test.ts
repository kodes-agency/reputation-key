// The History line for codes and health: who made, replaced or stopped a code,
// and what the Portal's health said. (Publishing and page edits are in
// portal-history-line.test.ts.)

import { describe, expect, it } from 'vitest'
import type {
  PortalHistoryDetail,
  PortalHistoryEntry,
} from '#/contexts/portal/application/public-api'
import { phraseText, type Phrase } from './portal-history-phrase'
import { describeHistoryEntry } from './portal-history-line'

const entry = (
  detail: PortalHistoryDetail,
  actor: PortalHistoryEntry['actor'] = { userId: 'u1', displayName: 'Elena Petrova' },
): PortalHistoryEntry => ({
  key: 'key',
  category: 'edits',
  occurredAt: '2026-09-30T08:05:00.000Z',
  actor,
  detail,
})

const line = (
  detail: PortalHistoryDetail,
  actor?: PortalHistoryEntry['actor'],
  versionSummary: Phrase | null = null,
  timeZone = 'UTC',
) => {
  const described = describeHistoryEntry(entry(detail, actor), {
    portalName: 'Pool & Terrace',
    versionSummary,
    timeZone,
    now: new Date('2026-09-30T09:00:00.000Z'),
  })
  return {
    ...described,
    action: phraseText(described.action),
    detail: described.detail === null ? null : phraseText(described.detail),
  }
}

describe('describeHistoryEntry: codes', () => {
  it('words each code event, with the person when there is one', () => {
    expect(line({ kind: 'code_issued', version: 1 })).toMatchObject({
      glyph: 'code',
      action: 'made a code',
    })
    expect(line({ kind: 'code_issued', version: 1 }, null)).toMatchObject({
      actor: null,
      action: 'A code was made',
    })
    expect(line({ kind: 'codes_revoked', reason: 'Tags lost' })).toMatchObject({
      glyph: 'stopped',
      action: 'stopped all codes',
      detail: 'Tags lost',
    })
  })

  it('says until when the replaced code keeps working', () => {
    expect(
      line({
        kind: 'code_replaced',
        version: 2,
        previousCodesWorkUntil: '2026-10-14T00:00:00.000Z',
      }),
    ).toMatchObject({
      action: 'replaced the code',
      detail: 'the old one works until 14 Oct',
    })
    expect(
      line({ kind: 'code_replaced', version: 2, previousCodesWorkUntil: null }),
    ).toMatchObject({ detail: 'the old one stopped working' })
  })

  it('reads the day the old code stops working in the Property zone, not UTC', () => {
    // 23:30 UTC on the 14th is already the 15th east of UTC.
    expect(
      line(
        {
          kind: 'code_replaced',
          version: 2,
          previousCodesWorkUntil: '2026-10-14T23:30:00.000Z',
        },
        undefined,
        null,
        'Pacific/Auckland',
      ),
    ).toMatchObject({ detail: 'the old one works until 15 Oct' })
  })

  it('says what a download was for', () => {
    expect(
      line({ kind: 'code_downloaded', version: 1, purpose: 'download' }),
    ).toMatchObject({
      glyph: 'download',
      action: 'downloaded the code again',
    })
    expect(line({ kind: 'code_downloaded', version: 1, purpose: 'copy' })).toMatchObject({
      glyph: 'copy',
      action: 'copied the NFC address',
    })
    expect(line({ kind: 'code_downloaded', version: 1, purpose: 'show' })).toMatchObject({
      action: 'viewed the address',
    })
  })
})

describe('describeHistoryEntry: health', () => {
  it('has no person and says back to working', () => {
    expect(
      line({ kind: 'health_changed', status: 'healthy', reason: 'operational' }, null),
    ).toMatchObject({
      glyph: 'health_ok',
      actor: null,
      action: 'Health: back to working',
    })
  })

  it('says what needs attention, or what is not available', () => {
    expect(
      line(
        {
          kind: 'health_changed',
          status: 'degraded',
          reason: 'google_destination_unavailable',
        },
        null,
      ),
    ).toMatchObject({
      glyph: 'health_warn',
      action: 'Health: needs attention',
      detail: 'the Google link is not available',
    })
    expect(
      line(
        {
          kind: 'health_changed',
          status: 'unavailable',
          reason: 'public_address_unavailable',
        },
        null,
      ),
    ).toMatchObject({ glyph: 'health_off', detail: 'it has no working code' })
  })
})
