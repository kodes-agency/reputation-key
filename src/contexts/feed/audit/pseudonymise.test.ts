import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AUDIT_PSEUDONYM_SECRET_MISSING,
  auditPseudonymKey,
  auditRowPseudonymiser,
  type AuditEventRow,
  type AuditLogRow,
} from './pseudonymise.server'

describe('auditPseudonymKey', () => {
  it('is stable for one secret and one journal entry', () => {
    expect(auditPseudonymKey('secret-a', 'entry-1')).toBe(
      auditPseudonymKey('secret-a', 'entry-1'),
    )
  })

  it('changes when the secret changes', () => {
    expect(auditPseudonymKey('secret-a', 'entry-1')).not.toBe(
      auditPseudonymKey('secret-b', 'entry-1'),
    )
  })

  it('changes with the journal entry, so scopes do not share pseudonyms', () => {
    expect(auditPseudonymKey('secret-a', 'entry-1')).not.toBe(
      auditPseudonymKey('secret-a', 'entry-2'),
    )
  })

  it('is not derivable from the journal entry id alone', () => {
    expect(auditPseudonymKey('secret-a', 'entry-1')).not.toBe(
      createHmac('sha256', 'entry-1').update('entry-1').digest('hex'),
    )
  })

  it('refuses a missing or empty secret and names the setting, not a value', () => {
    expect(() => auditPseudonymKey('', 'entry-1')).toThrow(AUDIT_PSEUDONYM_SECRET_MISSING)
    expect(() => auditPseudonymKey(undefined, 'entry-1')).toThrow(
      'AUDIT_PSEUDONYM_SECRET is not set',
    )
  })
})

describe('auditRowPseudonymiser', () => {
  const PSEUDONYM = /^pseudonym:[0-9a-f]{32}$/
  const rewrite = auditRowPseudonymiser(
    auditPseudonymKey('secret-a', 'entry-1'),
    new Set(['user-dana']),
  )
  const log = (row: Partial<AuditLogRow>): AuditLogRow => ({
    id: 'log-1',
    user_id: 'user-dana',
    action: 'goal.program.status_changed',
    ip_address: null,
    details: {},
    ...row,
  })
  const event = (row: Partial<AuditEventRow>): AuditEventRow => ({
    id: 'event-1',
    actor_type: 'user',
    actor_id: 'user-dana',
    resource_type: 'goal_program',
    resource_id: 'program-1',
    source_aggregate_id: null,
    ...row,
  })

  it('catches an email address inside free text under a key it does not list', () => {
    const details = {
      summary: 'Call dana@example.test before Friday',
      thread: [{ body: 'Copy to <sam@example.test>, please' }],
    }

    const after = rewrite.log(log({ details })).details as typeof details

    expect(after.summary).toMatch(/^Call pseudonym:[0-9a-f]{32} before Friday$/)
    expect(after.thread[0]!.body).toMatch(/^Copy to <pseudonym:[0-9a-f]{32}>, please$/)
    expect(JSON.stringify(after)).not.toContain('@example.test')
    const again = rewrite.log(log({ details: { other: 'dana@example.test' } }))
    expect(after.summary).toContain((again.details as { other: string }).other)
  })

  it('leaves free text with no email address as it is', () => {
    const details = {
      label: 'Front desk @ lobby',
      link: 'https://example.test/reviews?sort=new',
      count: 2,
      active: true,
    }

    expect(rewrite.log(log({ details })).details).toEqual(details)
  })

  it('replaces a whole value under a personal key and a person named as a key', () => {
    const details = {
      reason: 'Dana asked',
      votes: { 'user-dana': 1 },
      actors: ['user-dana'],
    }

    const after = rewrite.log(log({ details })).details as {
      reason: string
      votes: Record<string, number>
      actors: string[]
    }

    expect(after.reason).toMatch(PSEUDONYM)
    expect(Object.keys(after.votes)).toEqual([after.actors[0]])
    expect(after.actors[0]).toMatch(PSEUDONYM)
  })

  it('keeps operator handles wherever they appear', () => {
    const row = log({
      user_id: 'ops:auditor',
      details: {
        actorId: 'ops:auditor',
        userId: 'ops:auditor',
        handledBy: 'ops:auditor',
      },
    })

    expect(rewrite.log(row)).toEqual(row)
    const operatorEvent = event({ actor_type: 'operator', actor_id: 'ops:auditor' })
    expect(rewrite.event(operatorEvent)).toEqual(operatorEvent)
    const handleAsUser = event({ actor_id: 'ops:auditor' })
    expect(rewrite.event(handleAsUser)).toEqual(handleAsUser)
  })

  it("keeps the platform operator's user id on the operator console's records", () => {
    const row = log({
      user_id: 'operator-user-1',
      action: 'platform.admin_invited',
      details: { invitationId: 'invitation-1', operatorUserId: 'operator-user-1' },
    })

    expect(rewrite.log(row)).toEqual(row)
  })

  it('still replaces text that only starts with the operator prefix, and customer user ids', () => {
    const after = rewrite.log(
      log({
        details: { reason: 'ops: Dana called', note: 'ops:dana@example.test said so' },
      }),
    )

    expect(after.user_id).toMatch(PSEUDONYM)
    expect(after.details).toEqual({
      reason: expect.stringMatching(PSEUDONYM),
      note: expect.stringMatching(PSEUDONYM),
    })
    expect(rewrite.event(event({})).actor_id).toBe(after.user_id)
  })
})
