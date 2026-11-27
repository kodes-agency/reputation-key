import { createHmac } from 'node:crypto'

/** A valid `svix-signature` header value for the given delivery. */
export function signSvixPayload(
  input: Readonly<{
    id: string
    timestamp: string
    rawBody: string
    signingSecret: string
  }>,
): string {
  const encoded = input.signingSecret.startsWith('whsec_')
    ? input.signingSecret.slice('whsec_'.length)
    : input.signingSecret
  const key = Buffer.from(encoded, 'base64')
  if (key.length === 0) throw new Error('Malformed Svix signing secret')
  const digest = createHmac('sha256', key)
    .update(`${input.id}.${input.timestamp}.${input.rawBody}`)
    .digest('base64')
  return `v1,${digest}`
}
