import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  PortalAddressCipherError,
  createPortalAddressCipher,
  parsePortalAddressKeyring,
} from './portal-address-cipher'

const CONTEXT = Object.freeze({
  organizationId: 'org-1',
  propertyId: '10000000-0000-4000-8000-000000000002',
  portalId: '10000000-0000-4000-8000-000000000003',
  tokenId: '10000000-0000-4000-8000-000000000004',
  version: 3,
})
const RAW_TOKEN = `pt_${'A'.repeat(16)}_${'b'.repeat(43)}`
const KEY_1 = '11'.repeat(32)
const KEY_2 = '22'.repeat(32)
const KEYRING = `2:${KEY_2},1:${KEY_1}`

const cipher = (keyring = KEYRING) =>
  createPortalAddressCipher({ keyring, generateIv: () => randomBytes(12) })

describe('parsePortalAddressKeyring', () => {
  it('takes the first entry as the active key and keeps the rest to open', () => {
    const parsed = parsePortalAddressKeyring(KEYRING)
    expect(parsed.activeVersion).toBe(2)
    expect([...parsed.keys.keys()]).toEqual([2, 1])
  })

  it.each([
    ['empty', ''],
    ['a bare key', KEY_1],
    ['a short key', `1:${'ab'.repeat(31)}`],
    ['upper-case hex', `1:${'AB'.repeat(32)}`],
    ['version zero', `0:${KEY_1}`],
    ['a repeated version', `1:${KEY_1},1:${KEY_2}`],
    ['a trailing comma', `1:${KEY_1},`],
    ['a non-numeric version', `v1:${KEY_1}`],
  ])('refuses %s', (_label, value) => {
    expect(() => parsePortalAddressKeyring(value)).toThrowError(PortalAddressCipherError)
  })
})

describe('Portal address cipher', () => {
  it('seals with the active key and opens with the exact scope', () => {
    const sealed = cipher().seal(RAW_TOKEN, CONTEXT)

    expect(sealed.keyVersion).toBe(2)
    expect(sealed.ciphertext).not.toContain(RAW_TOKEN)
    expect(cipher().open(sealed, CONTEXT)).toBe(RAW_TOKEN)
  })

  it('seals the same address differently each time', () => {
    const first = cipher().seal(RAW_TOKEN, CONTEXT)
    const second = cipher().seal(RAW_TOKEN, CONTEXT)
    expect(first.ciphertext).not.toBe(second.ciphertext)
  })

  it.each([
    ['organization', { organizationId: 'org-2' }],
    ['property', { propertyId: '20000000-0000-4000-8000-000000000002' }],
    ['portal', { portalId: '20000000-0000-4000-8000-000000000003' }],
    ['token', { tokenId: '20000000-0000-4000-8000-000000000004' }],
    ['version', { version: 4 }],
  ])('refuses a ciphertext moved to another %s', (_label, change) => {
    const sealed = cipher().seal(RAW_TOKEN, CONTEXT)
    expect(() => cipher().open(sealed, { ...CONTEXT, ...change })).toThrowError(
      PortalAddressCipherError,
    )
  })

  it('opens a value sealed by a retained key and reports which keys it can open', () => {
    const old = cipher(`1:${KEY_1}`).seal(RAW_TOKEN, CONTEXT)
    const rotated = cipher()

    expect(old.keyVersion).toBe(1)
    expect(rotated.canOpen(1)).toBe(true)
    expect(rotated.canOpen(2)).toBe(true)
    expect(rotated.canOpen(3)).toBe(false)
    expect(rotated.open(old, CONTEXT)).toBe(RAW_TOKEN)
  })

  it('refuses a value whose key was retired from the keyring', () => {
    const old = cipher(`1:${KEY_1}`).seal(RAW_TOKEN, CONTEXT)
    expect(() => cipher(`2:${KEY_2}`).open(old, CONTEXT)).toThrowError(
      PortalAddressCipherError,
    )
  })

  it('refuses a damaged or truncated value', () => {
    const sealed = cipher().seal(RAW_TOKEN, CONTEXT)
    const [iv, tag, body] = sealed.ciphertext.split(':')
    const flipped = Buffer.from(body ?? '', 'base64')
    flipped[0] = (flipped[0] ?? 0) ^ 0xff

    for (const ciphertext of [
      `${iv}:${tag}:${flipped.toString('base64')}`,
      `${iv}:${tag}`,
      `${iv}::${body}`,
      '',
    ]) {
      expect(() => cipher().open({ ...sealed, ciphertext }, CONTEXT)).toThrowError(
        PortalAddressCipherError,
      )
    }
  })

  it('refuses to seal something that is not a Portal address token', () => {
    expect(() => cipher().seal('not-a-token', CONTEXT)).toThrowError(
      PortalAddressCipherError,
    )
  })

  it('refuses an initialisation vector of the wrong size', () => {
    const broken = createPortalAddressCipher({
      keyring: KEYRING,
      generateIv: () => randomBytes(8),
    })
    expect(() => broken.seal(RAW_TOKEN, CONTEXT)).toThrowError(PortalAddressCipherError)
  })

  it('says nothing about the address or the key in its error', () => {
    const sealed = cipher().seal(RAW_TOKEN, CONTEXT)
    try {
      cipher().open(sealed, { ...CONTEXT, version: 9 })
      expect.unreachable()
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(RAW_TOKEN)
      expect(String((error as Error).message)).not.toContain(KEY_2)
    }
  })
})
