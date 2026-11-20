import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { AiSubjectHmacPort } from './ai-subject-hmac.port.server'

const SUBJECT_AUDIENCE = 'repkey-ai-review-subject-v1'

export const createAiSubjectHmacAdapter = (rawKeyring: string): AiSubjectHmacPort => {
  const keyring = createVersionedHmacKeyring(rawKeyring)
  return Object.freeze({
    sign(subject) {
      const signed = keyring.sign(SUBJECT_AUDIENCE, subject)
      return {
        keyVersion: signed.keyVersion,
        digest: Buffer.from(signed.digest, 'base64url').toString('hex'),
      }
    },
  })
}
