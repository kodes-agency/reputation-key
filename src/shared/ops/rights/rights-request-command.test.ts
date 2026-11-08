import { describe, expect, it } from 'vitest'
import type { ErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import { parseOperatorArgs, type OperatorContext } from '../operator-command'
import {
  describeRightsReport,
  planRightsReplay,
  planRightsRequest,
  rightsConfirmationText,
  rightsRequestCommandSpec,
  type RightsRequestPlan,
} from './rights-request-command'

const ORG = 'org-1'
const PROPERTY = '5eed0100-0000-4000-8000-000000000001'
const OTHER_PROPERTY = '5eed0100-0000-4000-8000-000000000002'
const RESPONSE = '5eed0100-0000-4000-8000-0000000000a1'
const SUBJECT = 'a'.repeat(64)
const DEV = { production: false }
const PROD = { production: true }

function plan(argv: string[], env = DEV, dryRun?: boolean) {
  const parsed = parseOperatorArgs(
    ['--operator', 'op', '--org', ORG, ...argv],
    rightsRequestCommandSpec,
  )
  if (!parsed.ok) throw new Error(parsed.error)
  const ctx = {
    operatorId: 'op',
    correlationId: 'c',
    organizationId: ORG,
    propertyId: parsed.args.propertyId,
    dryRun: dryRun ?? !parsed.args.apply,
    batchSize: parsed.args.batchSize,
  } as unknown as OperatorContext
  return planRightsRequest(ctx, parsed.args, env)
}

describe('export directory', () => {
  it('carries out=<dir> into the plan', () => {
    const result = plan(['access', 'out=/tmp/export'])
    expect(result.ok && result.plan.exportDir).toBe('/tmp/export')
  })
})

const VERIFIED = ['verified=2026-11-01T10:00:00Z', 'verification=ticket:123']

describe('planRightsRequest', () => {
  it('rejects an unknown scope', () => {
    expect(plan(['everything'])).toEqual({
      ok: false,
      error: expect.stringContaining('scope must be one of'),
    })
  })

  it('defaults to a report and computes the 30-day and seven-day deadlines', () => {
    const result = plan([
      'access',
      'received=2026-11-01T00:00:00Z',
      'verified=2026-11-03T00:00:00Z',
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.mode).toBe('report')
    expect(result.plan.answerDueAt?.toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(result.plan.exportDueAt?.toISOString()).toBe('2026-11-10T00:00:00.000Z')
  })

  it('requires a SHA-256 subject reference, never an identifier', () => {
    expect(plan(['participant', 'subject-ref=jane@example.com'])).toMatchObject({
      ok: false,
      error: expect.stringContaining('SHA-256'),
    })
    expect(plan(['participant'])).toMatchObject({ ok: false })
  })

  it('refuses apply in production before anything else', () => {
    const result = plan(
      [
        'property',
        '--property',
        PROPERTY,
        ...VERIFIED,
        `confirm=${rightsConfirmationText('property', { organizationId: ORG, propertyId: PROPERTY })}`,
        '--apply',
      ],
      PROD,
    )
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('disabled in production'),
    })
  })

  it('still allows report and replay in production', () => {
    expect(plan(['organization'], PROD).ok).toBe(true)
    expect(
      plan(
        [
          'organization',
          'replay',
          'journal=/tmp/j.json',
          'restore-point=2026-11-01T00:00:00Z',
        ],
        PROD,
      ).ok,
    ).toBe(true)
  })

  it('refuses apply without a verified identity', () => {
    expect(
      plan(['participant', `subject-ref=${SUBJECT}`, 'confirm=x', '--apply']),
    ).toMatchObject({ ok: false, error: expect.stringContaining('no identity') })
  })

  it('refuses apply without the exact typed confirmation', () => {
    expect(
      plan([
        'guest-response',
        '--property',
        PROPERTY,
        `response=${RESPONSE}`,
        ...VERIFIED,
        'confirm=ERASE GUEST-RESPONSE nope',
        '--apply',
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('typed confirmation') })
  })

  it('accepts apply in development with identity and the exact confirmation', () => {
    const result = plan([
      'guest-response',
      '--property',
      PROPERTY,
      `response=${RESPONSE}`,
      ...VERIFIED,
      `confirm=ERASE GUEST-RESPONSE ${RESPONSE}`,
      '--apply',
    ])
    expect(result).toMatchObject({
      ok: true,
      plan: { mode: 'apply', responseId: RESPONSE },
    })
  })

  it('treats access as a report with no apply mode', () => {
    expect(
      plan(['access', `subject-ref=${SUBJECT}`, ...VERIFIED, '--apply']),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('no apply mode'),
    })
  })

  it('needs a journal file and restore point for replay', () => {
    expect(plan(['property', '--property', PROPERTY, 'replay'])).toMatchObject({
      ok: false,
      error: expect.stringContaining('journal'),
    })
  })
})

describe('describeRightsReport', () => {
  const base = {
    scope: 'organization',
    mode: 'report',
    organizationId: ORG,
    batchSize: 50,
  } as RightsRequestPlan

  it('states the delivery rule and the closure warning', () => {
    const text = describeRightsReport(base).join('\n')
    expect(text).toContain('24-hour download link')
    expect(text).toContain('never emailed as an attachment')
    expect(text).toContain('closure warning')
  })
})

describe('planRightsReplay', () => {
  const entry = (
    id: string,
    organizationId: string,
    propertyId: string | undefined,
    at: string,
  ): ErasureJournalEntry => ({
    id,
    recordedBeforeErasure: true,
    subjectClass: 'property',
    organizationId,
    ...(propertyId ? { propertyId } : {}),
    context: 'guest',
    closureLineageId: '5eed0100-0000-4000-8000-0000000000b1',
    lifecycleRevision: 1,
    effectiveErasureAt: new Date(at),
    erasedRowCount: 1,
    evidenceRef: 'e:1',
  })
  const replayPlan = {
    scope: 'property',
    mode: 'replay',
    organizationId: ORG,
    propertyId: PROPERTY,
    batchSize: 50,
    restorePointAt: new Date('2026-11-01T00:00:00Z'),
  } as RightsRequestPlan

  it('keeps another Property and another Organization out of the replay', () => {
    const items = planRightsReplay(replayPlan, [
      entry(
        '5eed0100-0000-4000-8000-0000000000c1',
        ORG,
        PROPERTY,
        '2026-11-02T00:00:00Z',
      ),
      entry(
        '5eed0100-0000-4000-8000-0000000000c2',
        ORG,
        OTHER_PROPERTY,
        '2026-11-02T00:00:00Z',
      ),
      entry(
        '5eed0100-0000-4000-8000-0000000000c3',
        'org-2',
        PROPERTY,
        '2026-11-02T00:00:00Z',
      ),
    ])
    expect(items).toEqual([
      {
        journalId: '5eed0100-0000-4000-8000-0000000000c1',
        scope: 'property',
        disposition: 'replay_required',
      },
    ])
  })

  it('replays an intent even when it predates the restore point', () => {
    const [item] = planRightsReplay(replayPlan, [
      entry(
        '5eed0100-0000-4000-8000-0000000000c4',
        ORG,
        PROPERTY,
        '2026-10-01T00:00:00Z',
      ),
    ])
    expect(item?.disposition).toBe('replay_required')
  })
})
