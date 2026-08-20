import { createHash } from 'node:crypto'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'

export type GoogleCredentialBinder = (credential: string) => string

export function createGoogleCredentialBinder(
  keyring: VersionedHmacKeyring,
): GoogleCredentialBinder {
  return (credential) => {
    if (
      typeof credential !== 'string' ||
      credential.length === 0 ||
      Buffer.byteLength(credential, 'utf8') > 8 * 1024
    ) {
      throw new Error('Google credential binding input is invalid')
    }
    const signature = keyring.sign('google-provider-credential-binding-v1', credential)
    return createHash('sha256')
      .update(signature.keyVersion, 'utf8')
      .update('\0', 'utf8')
      .update(signature.digest, 'utf8')
      .digest('hex')
  }
}
