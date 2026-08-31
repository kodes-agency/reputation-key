import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  PRIVACY_CONTENT_CLASSIFICATIONS,
  PRIVACY_REQUEST_KINDS,
  PRIVACY_SUBJECT_TYPES,
  privacyRequestTransitions,
  privacyRequests,
} from './privacy-request.schema'

const config = getTableConfig(privacyRequests)
const transitions = getTableConfig(privacyRequestTransitions)

function checkExpression(name: string): string {
  const found = config.checks.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`missing check constraint ${name}`)
  return found.value.queryChunks
    .map((chunk) =>
      typeof chunk === 'object' && chunk !== null && 'value' in chunk
        ? String((chunk as { value: unknown }).value)
        : String(chunk),
    )
    .join('')
}

describe('privacy request schema (LIF-01-T20)', () => {
  it('is tenant AND property scoped', () => {
    // An unscoped request cannot be answered without reading across tenants.
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    )
    expect(columns.organization_id?.notNull).toBe(true)
    expect(columns.property_id?.notNull).toBe(true)
  })

  it('identifies the subject by digest, never by the identifier', () => {
    expect(checkExpression('privacy_requests_subject_ref_valid')).toContain(
      "~ '^[a-f0-9]{64}$'",
    )
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    )
    expect(columns.subject_ref?.columnType).toBe('PgChar')
    expect(columns.subject_ref?.notNull).toBe(true)
  })

  it('lets no state past received exist without identity verification', () => {
    expect(checkExpression('privacy_requests_verification_required')).toContain(
      "= 'received'",
    )
    expect(checkExpression('privacy_requests_verification_required')).toContain(
      'IS NOT NULL',
    )
  })

  it('requires an explicit refusal reason code and no free text', () => {
    expect(checkExpression('privacy_requests_refusal_reason_required')).toContain(
      "= 'refused'",
    )
    const refs = checkExpression('privacy_requests_refs_valid')
    expect(refs).toContain("~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'")
    // A reason and a target field are codes; a value would be subject content.
    expect(refs).toContain("~ '^[a-z][a-z0-9_]{0,63}$'")
  })

  it('binds an access package to an expiry', () => {
    const expression = checkExpression('privacy_requests_package_valid')
    expect(expression).toContain("= 'access'")
    expect(expression).toContain('IS NOT NULL')
  })

  it('enumerates only the declared kinds, subject types and classifications', () => {
    expect([...PRIVACY_REQUEST_KINDS]).toEqual([
      'access',
      'correction',
      'withdrawal',
      'erasure',
    ])
    expect([...PRIVACY_SUBJECT_TYPES]).toEqual(['guest', 'participant'])
    expect([...PRIVACY_CONTENT_CLASSIFICATIONS]).toEqual([
      'content_free',
      'personal',
      'sensitive',
    ])
    for (const kind of PRIVACY_REQUEST_KINDS) {
      expect(checkExpression('privacy_requests_kind_valid')).toContain(`'${kind}'`)
    }
  })

  it('keeps transition evidence append-only-shaped and content-free', () => {
    expect(transitions.name).toBe('privacy_request_transitions')
    expect(transitions.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      'request_id',
      'to_state',
    ])
    expect(transitions.columns.map((column) => column.name)).not.toContain('note')
    expect(transitions.columns.map((column) => column.name)).not.toContain('subject_ref')
  })
})
