import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  deriveCanarySafetyIdentifier,
  derivePropertySafetyIdentifier,
} from './safety-identifier'

function tuple(...members: string[]): Buffer {
  const chunks: Buffer[] = []
  for (const member of members) {
    const bytes = Buffer.from(member, 'utf8')
    const length = Buffer.alloc(4)
    length.writeUInt32BE(bytes.byteLength)
    chunks.push(length, bytes)
  }
  return Buffer.concat(chunks)
}

describe('OpenAI safety identifiers', () => {
  const key = Buffer.alloc(32, 0x2a)

  it('derives a property-scoped scheduled identifier without exposing IDs', () => {
    const actual = derivePropertySafetyIdentifier({
      kind: 'system',
      organizationId: 'org-internal',
      propertyId: '00000000-0000-4000-8000-000000000001',
      key,
    })
    const expected = `rk1_${createHmac('sha256', key)
      .update('repkey-ai-safety-identifier-v1\0', 'utf8')
      .update(tuple('system', 'org-internal', '00000000-0000-4000-8000-000000000001'))
      .digest('base64url')}`
    expect(actual).toBe(expected)
    expect(actual).not.toContain('org-internal')
    expect(actual).not.toContain('00000000')
  })

  it('binds the actor only for interactive reply requests', () => {
    const base = {
      kind: 'interactive' as const,
      organizationId: 'org-internal',
      propertyId: '00000000-0000-4000-8000-000000000001',
      key,
    }
    expect(derivePropertySafetyIdentifier({ ...base, actorId: 'actor-a' })).not.toBe(
      derivePropertySafetyIdentifier({ ...base, actorId: 'actor-b' }),
    )
  })

  it('binds the exact unnormalized actor bytes', () => {
    const base = {
      kind: 'interactive' as const,
      organizationId: '00000000-0000-4000-8000-000000000001',
      propertyId: '00000000-0000-4000-8000-000000000002',
      key,
    }
    expect(derivePropertySafetyIdentifier({ ...base, actorId: 'e\u0301' })).not.toBe(
      derivePropertySafetyIdentifier({ ...base, actorId: '\u00e9' }),
    )
  })

  it('uses the repository-fixed canary value independently of normal keys', () => {
    const expected = `rk1_${createHash('sha256')
      .update('repkey-synthetic-canary-safety-v1\0', 'utf8')
      .digest('base64url')}`
    expect(deriveCanarySafetyIdentifier()).toBe(expected)
  })

  it('rejects short keys and invalid identifiers', () => {
    expect(() =>
      derivePropertySafetyIdentifier({
        kind: 'system',
        organizationId: 'org',
        propertyId: 'property',
        key: Buffer.alloc(31),
      }),
    ).toThrow(new TypeError('AI safety identifier key is too short'))
    expect(() =>
      derivePropertySafetyIdentifier({
        kind: 'interactive',
        organizationId: 'org',
        propertyId: 'property',
        actorId: 'bad\u0000actor',
        key,
      }),
    ).toThrow(new TypeError('Invalid actorId for AI safety identifier'))
  })
})
