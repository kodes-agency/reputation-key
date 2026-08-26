import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { z } from 'zod/v4'
import {
  contactRequestEmailSchema,
  contactRequestNameSchema,
} from '../../application/dto/contact-request.dto'
import type {
  ContactRequestEncryptionContext,
  ContactRequestEncryptionPort,
  SealedContactRequestValue,
} from '../../application/ports/contact-request-encryption.port'

const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,49}$/
const KEY_PATTERN = /^[a-f0-9]{64}$/
const SEALED_CONTACT_SCHEMA = z.strictObject({
  version: z.literal(1),
  email: contactRequestEmailSchema,
  name: contactRequestNameSchema.optional(),
})

export class ContactRequestEncryptionError extends Error {
  constructor() {
    super('Contact Request data is unavailable')
    this.name = 'ContactRequestEncryptionError'
  }
}

function additionalData(context: ContactRequestEncryptionContext): Buffer {
  return Buffer.from(
    JSON.stringify([
      'guest-contact-request-v1',
      context.organizationId,
      context.propertyId,
      context.portalId,
      context.contactRequestId,
      context.responseId,
    ]),
    'utf8',
  )
}

export function createContactRequestEncryptionAdapter(
  input: Readonly<{
    activeKeyId: string
    keys: Readonly<Record<string, string>>
  }>,
): ContactRequestEncryptionPort {
  const keys = new Map<string, Buffer>()
  for (const [keyId, material] of Object.entries(input.keys)) {
    if (!KEY_ID_PATTERN.test(keyId) || !KEY_PATTERN.test(material)) {
      throw new ContactRequestEncryptionError()
    }
    keys.set(keyId, Buffer.from(material, 'hex'))
  }
  if (!KEY_ID_PATTERN.test(input.activeKeyId) || !keys.has(input.activeKeyId)) {
    throw new ContactRequestEncryptionError()
  }

  const seal = (
    contact: Parameters<ContactRequestEncryptionPort['seal']>[0],
    context: ContactRequestEncryptionContext,
  ): SealedContactRequestValue => {
    try {
      const parsed = SEALED_CONTACT_SCHEMA.parse({ version: 1, ...contact })
      const key = keys.get(input.activeKeyId)
      if (!key) throw new ContactRequestEncryptionError()
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(additionalData(context))
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(parsed), 'utf8'),
        cipher.final(),
      ])
      const authenticationTag = cipher.getAuthTag()
      return Object.freeze({
        keyId: input.activeKeyId,
        ciphertext: [iv, authenticationTag, encrypted]
          .map((part) => part.toString('base64'))
          .join(':'),
      })
    } catch {
      throw new ContactRequestEncryptionError()
    }
  }

  const open = (
    sealed: SealedContactRequestValue,
    context: ContactRequestEncryptionContext,
  ): ReturnType<ContactRequestEncryptionPort['open']> => {
    try {
      const key = keys.get(sealed.keyId)
      const parts = sealed.ciphertext.split(':')
      if (!key || parts.length !== 3) throw new ContactRequestEncryptionError()
      const [iv, authenticationTag, encrypted] = parts.map((part) =>
        Buffer.from(part, 'base64'),
      )
      if (
        !iv ||
        !authenticationTag ||
        !encrypted ||
        iv.length !== 12 ||
        authenticationTag.length !== 16 ||
        encrypted.length === 0
      ) {
        throw new ContactRequestEncryptionError()
      }
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAAD(additionalData(context))
      decipher.setAuthTag(authenticationTag)
      const plaintext = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString('utf8')
      const parsed = SEALED_CONTACT_SCHEMA.parse(JSON.parse(plaintext))
      return Object.freeze({
        email: parsed.email,
        ...(parsed.name === undefined ? {} : { name: parsed.name }),
      })
    } catch {
      throw new ContactRequestEncryptionError()
    }
  }

  return Object.freeze({ seal, open })
}
