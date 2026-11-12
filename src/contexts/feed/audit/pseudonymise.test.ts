import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { auditPseudonymKey } from './pseudonymise.server'

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

  it('refuses an empty secret', () => {
    expect(() => auditPseudonymKey('', 'entry-1')).toThrow('empty')
  })
})
