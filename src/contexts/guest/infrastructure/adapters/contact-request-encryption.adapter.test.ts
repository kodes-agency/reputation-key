import { describe, expect, it } from 'vitest'
import {
  ContactRequestEncryptionError,
  createContactRequestEncryptionAdapter,
} from './contact-request-encryption.adapter'

const CONTEXT = Object.freeze({
  organizationId: '10000000-0000-4000-8000-000000000001',
  propertyId: '10000000-0000-4000-8000-000000000002',
  portalId: '10000000-0000-4000-8000-000000000003',
  contactRequestId: '10000000-0000-4000-8000-000000000004',
  responseId: '10000000-0000-4000-8000-000000000005',
})

describe('Contact Request encryption adapter', () => {
  const adapter = () =>
    createContactRequestEncryptionAdapter({
      activeKeyId: 'v2',
      keys: {
        v1: '11'.repeat(32),
        v2: '22'.repeat(32),
      },
    })

  it('seals the same contact differently and opens either with its exact scope', () => {
    const contact = { email: 'guest@example.com', name: 'Guest Name' }
    const first = adapter().seal(contact, CONTEXT)
    const second = adapter().seal(contact, CONTEXT)

    expect(first.keyId).toBe('v2')
    expect(first.ciphertext).not.toBe(second.ciphertext)
    expect(first.ciphertext).not.toContain('guest@example.com')
    expect(first.ciphertext).not.toContain('Guest Name')
    expect(adapter().open(first, CONTEXT)).toEqual(contact)
  })

  it('refuses ciphertext moved to another tenant, response, or Contact Request', () => {
    const sealed = adapter().seal({ email: 'guest@example.com' }, CONTEXT)

    expect(() =>
      adapter().open(sealed, {
        ...CONTEXT,
        organizationId: '20000000-0000-4000-8000-000000000001',
      }),
    ).toThrowError(ContactRequestEncryptionError)
    expect(() =>
      adapter().open(sealed, {
        ...CONTEXT,
        responseId: '20000000-0000-4000-8000-000000000005',
      }),
    ).toThrowError(ContactRequestEncryptionError)
    expect(() =>
      adapter().open(sealed, {
        ...CONTEXT,
        contactRequestId: '20000000-0000-4000-8000-000000000004',
      }),
    ).toThrowError(ContactRequestEncryptionError)
  })

  it('fails closed for unknown versions and malformed key configuration', () => {
    expect(() =>
      adapter().open({ keyId: 'retired', ciphertext: 'not-material' }, CONTEXT),
    ).toThrowError(ContactRequestEncryptionError)
    expect(() =>
      createContactRequestEncryptionAdapter({
        activeKeyId: 'v1',
        keys: { v1: 'too-short' },
      }),
    ).toThrowError(ContactRequestEncryptionError)

    const sealed = adapter().seal({ email: 'guest@example.com' }, CONTEXT)
    const [iv, , encrypted] = sealed.ciphertext.split(':')
    expect(() =>
      adapter().open(
        {
          ...sealed,
          ciphertext: `${iv}:${Buffer.alloc(4).toString('base64')}:${encrypted}`,
        },
        CONTEXT,
      ),
    ).toThrowError(ContactRequestEncryptionError)
  })
})
