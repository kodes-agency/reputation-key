import { createHash } from 'node:crypto'

function uint32be(value: number): Buffer {
  const bytes = Buffer.allocUnsafe(4)
  bytes.writeUInt32BE(value)
  return bytes
}

function nonNullString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')
  return Buffer.concat([Buffer.from([1]), uint32be(bytes.byteLength), bytes])
}

export function computeAiLanguageProfileDigest(
  domain: string,
  members: readonly Readonly<{ path: string; bytes: Uint8Array }>[],
): string {
  const hash = createHash('sha256')
  hash.update(domain, 'utf8')
  hash.update(uint32be(members.length))
  for (const member of members) {
    hash.update(nonNullString(member.path))
    hash.update(uint32be(member.bytes.byteLength))
    hash.update(member.bytes)
  }
  return hash.digest('hex')
}
