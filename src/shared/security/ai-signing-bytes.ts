import { canonicalizeRfc8785 } from '../canonical-json'

export function canonicalAiSigningBytes(domain: string, value: unknown): Buffer {
  return Buffer.from(`${domain}${canonicalizeRfc8785(value)}`, 'utf8')
}
