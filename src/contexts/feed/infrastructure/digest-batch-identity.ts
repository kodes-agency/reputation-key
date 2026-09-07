import { createHash } from 'node:crypto'

const digestIdentity = (domain: string, values: readonly string[]): string => {
  const hash = createHash('sha256')
  hash.update(`${domain}\0`)
  for (const value of values) {
    hash.update(`${Buffer.byteLength(value, 'utf8')}:`).update(value)
  }
  return hash.digest('hex')
}

/** Content-free fingerprint of the exact queue rows owned by one batch. */
export function digestMemberSet(emailIds: readonly string[]): string {
  return digestIdentity('reputation-key/digest-members/v1', [...emailIds].sort())
}

/** Fingerprint every provider-visible field except the idempotency key itself. */
export function digestProviderRequest(input: {
  to: string
  subject: string
  html: string
  text: string
  headers?: Readonly<Record<string, string>>
}): string {
  const headers = Object.entries(input.headers ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )
  return digestIdentity('reputation-key/digest-provider-request/v1', [
    input.to,
    input.subject,
    input.html,
    input.text,
    ...headers.flatMap(([name, value]) => [name, value]),
  ])
}

/**
 * Bind the provider key to one recipient, local date, immutable batch, and
 * exact member fingerprint while staying inside provider key-size limits.
 */
export function digestBatchIdempotencyKey(input: {
  organizationId: string
  userId: string
  localDate: string
  batchId: string
  memberDigest: string
}): string {
  const digest = digestIdentity('reputation-key/digest-idempotency/v2', [
    input.organizationId,
    input.userId,
    input.localDate,
    input.batchId,
    input.memberDigest,
  ])
  return `rk-digest-v2:${digest}`
}
