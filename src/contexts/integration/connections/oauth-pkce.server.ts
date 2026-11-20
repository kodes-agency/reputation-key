import { createHash, randomBytes } from 'node:crypto'

/** Generate a PKCE verifier with 384 bits of entropy. */
export function generateCodeVerifier(): string {
  return randomBytes(48).toString('base64url')
}

/** RFC 7636 S256 challenge. */
export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/** One-time OIDC nonce bound to the signed ID token. */
export function generateOidcNonce(): string {
  return randomBytes(32).toString('base64url')
}
