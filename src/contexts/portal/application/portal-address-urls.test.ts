import { randomBytes } from 'node:crypto'
import QRCode from 'qrcode'
import { describe, expect, it } from 'vitest'
import {
  buildPortalPublicUrls,
  portalPublicUrls,
  type ChannelPrintCodes,
  type PortalAddressFormat,
} from './portal-address-urls'
import { PRINT_CODE_ALPHABET, printCodeFromBytes } from '../domain/print-code'

const RAW = `pt_${'A'.repeat(16)}_${'b'.repeat(43)}`
const QR_MARKER = '11111111-1111-4111-8111-111111111111'
const NFC_MARKER = '22222222-2222-4222-8222-222222222222'
const ARTIFACTS = { qr: QR_MARKER, nfc: NFC_MARKER }
const CODES: ChannelPrintCodes = {
  qr: '7K3QZ0VD9MWX4HT2BN6R',
  nfc: 'A1B2C3D4E5F6G7H8J9KM',
}
const NO_CODES: ChannelPrintCodes = { qr: null, nfc: null }

const PRINT_HOST = 'https://ap.up.railway.app'
const APP_HOST = 'https://web-closed-beta-v2.up.railway.app'

const build = (overrides: Partial<Parameters<typeof buildPortalPublicUrls>[0]> = {}) =>
  buildPortalPublicUrls({
    appOrigin: APP_HOST,
    printOrigin: PRINT_HOST,
    rawToken: RAW,
    artifacts: ARTIFACTS,
    printCodes: CODES,
    ...overrides,
  })

/** The QR version an address is drawn at, at error correction M (the print kit's and Share's). */
const versionOf = (address: string): number =>
  QRCode.create(address, { errorCorrectionLevel: 'M' }).version

const randomPrintCode = (): string => printCodeFromBytes(randomBytes(13))

describe('buildPortalPublicUrls', () => {
  it('writes the QR address on the print host, the code after /p/, everything else in capitals', () => {
    expect(build().qr).toBe('HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R')
  })

  it('writes the NFC address with a lowercase scheme and host, so a tag gets the https prefix byte', () => {
    expect(build().nfc).toBe('https://ap.up.railway.app/p/A1B2C3D4E5F6G7H8J9KM')
  })

  it('keeps the long address with no marker as `direct`, whatever the print codes are', () => {
    const direct = `${APP_HOST}/p/${RAW}`
    expect(build().direct).toBe(direct)
    expect(build({ printCodes: NO_CODES }).direct).toBe(direct)
    expect(build().direct).not.toContain('accessArtifact')
  })

  it('never lets `direct` carry a print code, or the short forms the long address', () => {
    const urls = build()
    expect(urls.direct).not.toContain('7K3QZ0VD9MWX4HT2BN6R')
    expect(urls.direct).not.toContain('A1B2C3D4E5F6G7H8J9KM')
    expect(urls.qr).not.toContain(RAW)
    expect(urls.nfc).not.toContain(RAW)
  })

  it('falls back to the long address with its own marker for a channel with no print code', () => {
    const long = (marker: string) => `${APP_HOST}/p/${RAW}?accessArtifact=${marker}`
    expect(build({ printCodes: NO_CODES })).toEqual({
      qr: long(QR_MARKER),
      nfc: long(NFC_MARKER),
      direct: `${APP_HOST}/p/${RAW}`,
    })
    expect(build({ printCodes: { qr: null, nfc: CODES.nfc } })).toMatchObject({
      qr: long(QR_MARKER),
      nfc: 'https://ap.up.railway.app/p/A1B2C3D4E5F6G7H8J9KM',
    })
    expect(build({ printCodes: { qr: CODES.qr, nfc: null } })).toMatchObject({
      qr: 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R',
      nfc: long(NFC_MARKER),
    })
  })

  it('takes the print origin as an origin: a trailing slash is not doubled', () => {
    expect(build({ printOrigin: `${PRINT_HOST}/` }).qr).toBe(
      'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R',
    )
    expect(build({ printOrigin: `${PRINT_HOST}/` }).nfc).toBe(
      'https://ap.up.railway.app/p/A1B2C3D4E5F6G7H8J9KM',
    )
  })

  it('is a version 3 symbol for every print code on the print host', () => {
    const codes = [
      '0'.repeat(20),
      PRINT_CODE_ALPHABET.at(-1)?.repeat(20) ?? '',
      '9'.repeat(20),
      ...Array.from({ length: 1000 }, randomPrintCode),
    ]
    const versions = new Set(
      codes.map((code) => versionOf(build({ printCodes: { qr: code, nfc: code } }).qr)),
    )
    expect([...versions]).toEqual([3])
  })

  it('is a version 4 symbol in lowercase, which is why the QR address is uppercase', () => {
    expect(versionOf(build().qr)).toBe(3)
    expect(versionOf(build().qr.toLowerCase())).toBe(4)
  })

  // The symbol each host can print, and what that leaves a tile (module = tile over
  // the symbol and its four-module quiet zone, never under 0.85 mm).
  it.each([
    ['the print host', 'https://ap.up.railway.app', 3],
    ['a short custom host', 'https://go.reputationkey.app', 3],
    ['the app host of the fixtures', 'https://app.reputationkey.app', 3],
    ['the e2e stack', 'http://127.0.0.1:3000', 3],
    ['the Railway app host, which gives a longer symbol', APP_HOST, 4],
  ])('draws %s at version %i', (_label, origin, version) => {
    expect(versionOf(build({ printOrigin: origin }).qr)).toBe(version)
  })

  it('writes an NFC address of at most 144 bytes, an NTAG213, on every host', () => {
    for (const origin of [PRINT_HOST, APP_HOST, 'http://127.0.0.1:3000']) {
      expect(Buffer.byteLength(build({ printOrigin: origin }).nfc)).toBeLessThanOrEqual(
        144,
      )
    }
    // The long address does not fit one on the beta (159 bytes), which is the point.
    const long = build({ printCodes: NO_CODES, printOrigin: APP_HOST }).nfc
    expect(Buffer.byteLength(long)).toBeGreaterThan(144)
  })
})

describe('portalPublicUrls', () => {
  const format = (printCodesEnabled: boolean): PortalAddressFormat => ({
    appOrigin: APP_HOST,
    printOrigin: PRINT_HOST,
    printCodesEnabled,
  })
  const input = { rawToken: RAW, artifacts: ARTIFACTS, printCodes: CODES }

  it('shows the short addresses only when they are switched on', () => {
    expect(portalPublicUrls(format(true), input).qr).toMatch(/^HTTPS:\/\/AP\.UP\./u)
    expect(portalPublicUrls(format(false), input)).toEqual(
      build({ printCodes: NO_CODES }),
    )
  })

  it('shows the same direct address either way', () => {
    expect(portalPublicUrls(format(true), input).direct).toBe(
      portalPublicUrls(format(false), input).direct,
    )
  })
})
