import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { createPortalTokenCodec } from './portal-token-codec'

describe('portal token codec', () => {
  it('issues a 256-bit opaque secret and stores only a keyed digest', () => {
    const chunks = [Buffer.alloc(12, 1), Buffer.alloc(32, 2)]
    const codec = createPortalTokenCodec({
      secret: 's'.repeat(32),
      randomBytes: () => chunks.shift()!,
    })

    const issued = codec.issue()

    expect(issued.rawToken).toMatch(/^pt_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/)
    expect(issued.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(issued.tokenHash).not.toContain(issued.rawToken)
    expect(codec.digest(issued.rawToken)).toEqual({
      kind: 'long',
      tokenIdentifier: issued.tokenIdentifier,
      tokenHash: issued.tokenHash,
      tokenKeyVersion: 1,
    })
  })

  it('rejects malformed public tokens before repository lookup', () => {
    const codec = createPortalTokenCodec({
      secret: 's'.repeat(32),
      randomBytes: Buffer.alloc,
    })
    expect(codec.digest('portal-1')).toBeNull()
    expect(codec.digest('pt_short_secret')).toBeNull()
  })

  it('rejects weak hashing secrets', () => {
    expect(() =>
      createPortalTokenCodec({ secret: 'weak', randomBytes: Buffer.alloc }),
    ).toThrow('PORTAL_TOKEN_HASH_SECRET must contain at least 32 bytes')
  })
})

// The vector was computed with a separate implementation (Python's hmac module,
// its own Crockford loop), not with this codec, so a change that moves every
// printed code fails here instead of at a customer's Download again.
const VECTOR = {
  secret: 'print-code-test-secret-0123456789',
  rawToken: 'pt_AQEBAQEBAQEBAQEB_AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
  accessArtifactIds: {
    qr: '0b6f1d52-7c3e-4a8e-9f1d-2a4c6e8f0a11',
    nfc: '5d9e3c71-1a2b-4c3d-8e4f-6a7b8c9d0e22',
  },
  qr: {
    printCode: 'S9KT3STHPDN6NJPAH2Y8',
    printCodeHash: 'a6a6241ba485a80d5a5a088f58258deefd19135e4f7eba398743c08b9d595419',
  },
  nfc: {
    printCode: 'SPNP0H032WX058TW4G50',
    printCodeHash: 'ffa210b5a88b5cfcbda468e327f0aa9ea9e46395030040956657550a2c733a5d',
  },
  longTokenHash: '75ac1ad819c920c34cf625254dd75d9de73720644bf3808e1ac7ee183645cfa3',
} as const

const vectorCodec = () =>
  createPortalTokenCodec({ secret: VECTOR.secret, randomBytes: Buffer.alloc })

const derive = (codec = vectorCodec(), overrides: Record<string, unknown> = {}) =>
  codec.derivePrintCodes({
    rawToken: VECTOR.rawToken,
    accessArtifactIds: VECTOR.accessArtifactIds,
    ...overrides,
  })

describe('print code derivation', () => {
  it('derives the fixed test vector', () => {
    expect(derive()).toEqual({ qr: VECTOR.qr, nfc: VECTOR.nfc })
  })

  it('gives the same codes every time and from every codec built on the secret', () => {
    expect(derive()).toEqual(derive(vectorCodec()))
  })

  it('gives each channel and each artifact its own code', () => {
    const base = derive()
    const other = derive(vectorCodec(), {
      accessArtifactIds: {
        ...VECTOR.accessArtifactIds,
        qr: VECTOR.accessArtifactIds.nfc,
      },
    })
    expect(base?.qr.printCode).not.toBe(base?.nfc.printCode)
    expect(other?.qr.printCode).not.toBe(base?.qr.printCode)
    // The NFC artifact id is unchanged, so its code is too.
    expect(other?.nfc).toEqual(base?.nfc)
    // The same artifact id on the other channel is a different message.
    expect(other?.qr.printCode).not.toBe(base?.nfc.printCode)
  })

  it('depends on the long address as well as the server secret', () => {
    const rotated = VECTOR.rawToken.replace('AQEB', 'AQEC')
    expect(derive(vectorCodec(), { rawToken: rotated })?.qr.printCode).not.toBe(
      VECTOR.qr.printCode,
    )
  })

  it('depends on the server secret', () => {
    const other = createPortalTokenCodec({
      secret: `${VECTOR.secret}-2`,
      randomBytes: Buffer.alloc,
    })
    expect(derive(other)?.qr.printCode).not.toBe(VECTOR.qr.printCode)
    expect(derive(other)?.qr.printCodeHash).not.toBe(VECTOR.qr.printCodeHash)
  })

  it('stores a hash that is neither the long address hash nor a plain hash of the code', () => {
    const codes = derive()
    expect(codes?.qr.printCodeHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(codes?.qr.printCodeHash).not.toBe(VECTOR.longTokenHash)
    // Keyed with the server secret itself, the hash would share its key with the
    // long address hash. The two subkeys keep the jobs apart.
    const plain = createHmac('sha256', VECTOR.secret)
      .update(VECTOR.qr.printCode)
      .digest('hex')
    expect(codes?.qr.printCodeHash).not.toBe(plain)
    expect(codes?.qr.printCodeHash).not.toBe(codes?.nfc.printCodeHash)
  })

  it('derives a 20 character Crockford code', () => {
    expect(derive()?.qr.printCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{20}$/u)
  })

  it('refuses what is not a long address or a usable artifact id', () => {
    for (const rawToken of ['', 'S9KT3STHPDN6NJPAH2Y8', 'pt_short_secret']) {
      expect(derive(vectorCodec(), { rawToken })).toBeNull()
    }
    const ids = VECTOR.accessArtifactIds
    for (const accessArtifactIds of [
      { ...ids, qr: '' },
      { ...ids, nfc: 'a|b' },
    ]) {
      expect(derive(vectorCodec(), { accessArtifactIds })).toBeNull()
    }
  })
})

describe('print code digest', () => {
  const codec = vectorCodec()
  const short = (printCodeHash: string) => ({ kind: 'short', printCodeHash })

  it('hashes a code to what derivation stored', () => {
    expect(codec.digest(VECTOR.qr.printCode)).toEqual(short(VECTOR.qr.printCodeHash))
    expect(codec.digest(VECTOR.nfc.printCode)).toEqual(short(VECTOR.nfc.printCodeHash))
  })

  it('reads a code in any case, or with its look-alikes, as the same code', () => {
    const expected = short(VECTOR.nfc.printCodeHash)
    expect(codec.digest(VECTOR.nfc.printCode.toLowerCase())).toEqual(expected)
    expect(codec.digest(VECTOR.nfc.printCode.replaceAll('0', 'O'))).toEqual(expected)
  })

  it('reads I and L as 1', () => {
    const one = '1'.repeat(20)
    const look = 'IlLiL'.repeat(4)
    expect(codec.digest(look)).toEqual(codec.digest(one))
  })

  it('refuses everything that is neither address shape, without hashing it', () => {
    for (const raw of [
      '',
      'portal-1',
      'pt_short_secret',
      VECTOR.qr.printCode.slice(1),
      VECTOR.qr.printCode + '2',
      'U' + VECTOR.qr.printCode.slice(1),
      '_' + VECTOR.qr.printCode.slice(1),
      'ſ' + VECTOR.qr.printCode.slice(1),
      'ı' + VECTOR.qr.printCode.slice(1),
      'ﬁ' + VECTOR.qr.printCode.slice(1),
      '７' + VECTOR.qr.printCode.slice(1),
    ]) {
      expect(codec.digest(raw), raw).toBeNull()
    }
  })

  it('tells the two shapes apart by kind, and a long address keeps its digest', () => {
    expect(codec.digest(VECTOR.qr.printCode)).toMatchObject({ kind: 'short' })
    expect(codec.digest(VECTOR.rawToken)).toMatchObject({
      kind: 'long',
      tokenHash: VECTOR.longTokenHash,
      tokenKeyVersion: 1,
    })
    // Nothing of the other shape rides along: a short digest has no long address
    // columns, and a long digest has no print code hash.
    expect(codec.digest(VECTOR.qr.printCode)).not.toHaveProperty('tokenHash')
    expect(codec.digest(VECTOR.rawToken)).not.toHaveProperty('printCodeHash')
  })

  it('answers isPrintCode from the shape alone', () => {
    expect(codec.isPrintCode(VECTOR.qr.printCode)).toBe(true)
    expect(codec.isPrintCode(VECTOR.qr.printCode.toLowerCase())).toBe(true)
    expect(codec.isPrintCode(VECTOR.rawToken)).toBe(false)
    expect(codec.isPrintCode('ſ' + VECTOR.qr.printCode.slice(1))).toBe(false)
    expect(codec.isPrintCode('')).toBe(false)
  })
})
