// The code tile per size (round-3 spec-delta S1 to S2) and the rule that picks it:
// a module of at least 0.85 mm, or Large keeps today's 2 in tile. The numbers
// here are the spec-delta's own tables; the addresses are real ones, run through
// the same `qrcode` library the print kit draws with.

import QRCode from 'qrcode'
import { describe, expect, it } from 'vitest'
import { GUEST_LOCALES, type GuestLocale } from './guest-locale'
import {
  PRINT_KIT_PAPERS,
  PRINT_KIT_QR_QUIET_ZONE_MODULES,
  PRINT_KIT_SCAN_CUE,
  PRINT_KIT_SIZES,
  type PrintKitPaper,
  type PrintKitSize,
} from './portal-print-kit'
import { estimatedCueWidthPt } from './portal-print-kit-code-block'
import {
  CODE_MODULE_MIN_MM,
  CODE_TILE,
  TODAY_CODE_TILE,
  chooseCodeTile,
  codeModuleMm,
  codeTileCueRoomPt,
  codeTileHeightPt,
  printAddressShape,
  type PrintAddressShape,
} from './portal-print-kit-code-tile'
import {
  CODE_BLOCK,
  TYPE_FLOOR_PT,
  inToPt,
  mmToPt,
  ptToIn,
  ptToMm,
} from './portal-print-kit-measures'

const TOKEN = `pt_${'A'.repeat(16)}_${'b'.repeat(43)}`
const MARKER = '0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10'
const CODE = '7K3QZ0VD9MWX4HT2BN6R'

/** What the beta prints today: its own host, the long token and the marker (159 characters). */
const BETA_ADDRESS = `https://web-closed-beta-v2.up.railway.app/p/${TOKEN}?accessArtifact=${MARKER}`
/** The fixture host the maps measured (147 characters). */
const FIXTURE_ADDRESS = `https://app.reputationkey.app/p/${TOKEN}?accessArtifact=${MARKER}`
/** The owner's print host: 17 characters, so the whole address is 48. */
const SHORT_ADDRESS = `HTTPS://AP.UP.RAILWAY.APP/p/${CODE}`
/** A print host that is too long for version 3: the symbol grows to version 4. */
const LONG_HOST_SHORT_CODE = `HTTPS://WEB-CLOSED-BETA-V2.UP.RAILWAY.APP/p/${CODE}`

/** The modules along one side of the symbol, quiet zone not included. */
const modulesOf = (address: string): number =>
  QRCode.create(address, { errorCorrectionLevel: 'M' }).modules.size

const versionOf = (address: string): number =>
  QRCode.create(address, { errorCorrectionLevel: 'M' }).version

const tileOf = (size: PrintKitSize, paper: PrintKitPaper) => CODE_TILE[size][paper]

describe('the addresses the rule is tested with', () => {
  it('make the symbols the spec-delta counts: version 9 and 8 for long addresses, 3 and 4 for short ones', () => {
    expect(BETA_ADDRESS).toHaveLength(159)
    expect(versionOf(BETA_ADDRESS)).toBe(9)
    expect(versionOf(FIXTURE_ADDRESS)).toBe(8)
    expect(SHORT_ADDRESS).toHaveLength(48)
    expect(versionOf(SHORT_ADDRESS)).toBe(3)
    expect(versionOf(LONG_HOST_SHORT_CODE)).toBe(4)
  })

  it('keep the lowercase print address one version up, which is why the builder asks for uppercase', () => {
    expect(versionOf(SHORT_ADDRESS.toLowerCase())).toBe(4)
  })
})

describe('the code tile per size (spec-delta S1 and S2)', () => {
  it('is 1.75 in on Large, 1.4 in (36 mm in Europe) on Table and 1.25 in (32 mm) on Mini', () => {
    expect(ptToIn(tileOf('large', 'letter').tilePt)).toBeCloseTo(1.75, 10)
    expect(ptToIn(tileOf('large', 'a4').tilePt)).toBeCloseTo(1.75, 10)
    expect(ptToIn(tileOf('table', 'letter').tilePt)).toBeCloseTo(1.4, 10)
    expect(ptToMm(tileOf('table', 'a4').tilePt)).toBeCloseTo(36, 10)
    expect(ptToIn(tileOf('mini', 'letter').tilePt)).toBeCloseTo(1.25, 10)
    expect(ptToMm(tileOf('mini', 'a4').tilePt)).toBeCloseTo(32, 10)
  })

  it('makes the bar 0.36 / 0.46 in on Large, 0.30 / 0.38 in on Table and 0.27 / 0.38 in on Mini', () => {
    const bars: Readonly<Record<PrintKitSize, readonly [number, number]>> = {
      large: [0.36, 0.46],
      table: [0.3, 0.38],
      mini: [0.27, 0.38],
    }
    for (const size of PRINT_KIT_SIZES) {
      for (const paper of PRINT_KIT_PAPERS) {
        const [one, two] = bars[size]
        expect(ptToIn(tileOf(size, paper).barPt.one)).toBeCloseTo(one, 10)
        expect(ptToIn(tileOf(size, paper).barPt.two)).toBeCloseTo(two, 10)
      }
    }
  })

  it('measures the code block, tile and bar, at 2.11 in on Large, 1.70 in on Table and 1.52 in on Mini', () => {
    expect(ptToIn(codeTileHeightPt(tileOf('large', 'letter'), 'one'))).toBeCloseTo(
      2.11,
      10,
    )
    expect(ptToIn(codeTileHeightPt(tileOf('table', 'letter'), 'one'))).toBeCloseTo(
      1.7,
      10,
    )
    expect(ptToIn(codeTileHeightPt(tileOf('mini', 'letter'), 'one'))).toBeCloseTo(
      1.52,
      10,
    )
  })

  it('sets the cue at 9 pt, 8 pt on Mini, and never under the size’s own reading floor', () => {
    for (const paper of PRINT_KIT_PAPERS) {
      expect(tileOf('large', paper).cuePt).toEqual({ one: 9, two: 9 })
      expect(tileOf('table', paper).cuePt).toEqual({ one: 9, two: 9 })
      expect(tileOf('mini', paper).cuePt).toEqual({ one: 8, two: 8 })
    }
    for (const paper of PRINT_KIT_PAPERS) {
      for (const size of ['large', 'table'] as const) {
        expect(tileOf(size, paper).cuePt.two).toBeGreaterThanOrEqual(TYPE_FLOOR_PT.read)
      }
    }
  })

  it('keeps the camera pictogram only from 1.75 in up', () => {
    for (const size of PRINT_KIT_SIZES) {
      for (const paper of PRINT_KIT_PAPERS) {
        const tile = tileOf(size, paper)
        expect(tile.pictogramPt !== null).toBe(tile.tilePt >= inToPt(1.75))
      }
    }
    expect(tileOf('large', 'letter').pictogramPt).not.toBeNull()
    expect(tileOf('table', 'letter').pictogramPt).toBeNull()
    expect(tileOf('mini', 'letter').pictogramPt).toBeNull()
  })

  it('rounds the corners at 5 % of the tile, as the 2 in tile does', () => {
    expect(TODAY_CODE_TILE.radiusPt / TODAY_CODE_TILE.tilePt).toBeCloseTo(0.05, 10)
    for (const size of PRINT_KIT_SIZES) {
      for (const paper of PRINT_KIT_PAPERS) {
        const tile = tileOf(size, paper)
        expect(tile.radiusPt / tile.tilePt).toBeCloseTo(0.05, 10)
      }
    }
  })

  it('shrinks with the size: each tile is smaller than the one before it, and every one is under 2 in', () => {
    for (const paper of PRINT_KIT_PAPERS) {
      expect(tileOf('table', paper).tilePt).toBeLessThan(tileOf('large', paper).tilePt)
      expect(tileOf('mini', paper).tilePt).toBeLessThan(tileOf('table', paper).tilePt)
      expect(tileOf('large', paper).tilePt).toBeLessThan(TODAY_CODE_TILE.tilePt)
    }
  })

  it('keeps today’s 2 in block exactly: the tile Large falls back to is the one every card prints on now', () => {
    expect(TODAY_CODE_TILE.tilePt).toBe(inToPt(2))
    expect(TODAY_CODE_TILE.barPt).toBe(CODE_BLOCK.barPt)
    expect(TODAY_CODE_TILE.cuePt).toBe(CODE_BLOCK.cuePt)
    expect(TODAY_CODE_TILE.pictogramPt).toBe(CODE_BLOCK.iconPt)
    expect(TODAY_CODE_TILE.barPaddingPt).toBe(CODE_BLOCK.barPaddingPt)
    expect(TODAY_CODE_TILE.iconGapPt).toBe(CODE_BLOCK.iconGapPt)
    expect(TODAY_CODE_TILE.radiusPt).toBe(CODE_BLOCK.radiusPt)
  })
})

describe('the module (tile over the symbol and its quiet zone)', () => {
  it('counts the quiet zone on both sides: four modules each', () => {
    expect(PRINT_KIT_QR_QUIET_ZONE_MODULES).toBe(4)
    expect(codeModuleMm(inToPt(2), 29)).toBeCloseTo(50.8 / 37, 10)
  })

  it('gives the spec-delta’s modules for today’s version 8 code (57 across)', () => {
    expect(codeModuleMm(tileOf('large', 'letter').tilePt, 49)).toBeCloseTo(0.78, 2)
    expect(codeModuleMm(tileOf('table', 'letter').tilePt, 49)).toBeCloseTo(0.62, 2)
    expect(codeModuleMm(tileOf('table', 'a4').tilePt, 49)).toBeCloseTo(0.63, 2)
    expect(codeModuleMm(tileOf('mini', 'letter').tilePt, 49)).toBeCloseTo(0.56, 2)
  })

  it('gives the spec-delta’s modules for a version 3 code (37 across)', () => {
    expect(codeModuleMm(tileOf('large', 'letter').tilePt, 29)).toBeCloseTo(1.2, 2)
    expect(codeModuleMm(tileOf('table', 'letter').tilePt, 29)).toBeCloseTo(0.96, 2)
    expect(codeModuleMm(tileOf('table', 'a4').tilePt, 29)).toBeCloseTo(0.97, 2)
    expect(codeModuleMm(tileOf('mini', 'letter').tilePt, 29)).toBeCloseTo(0.86, 2)
    expect(codeModuleMm(tileOf('mini', 'a4').tilePt, 29)).toBeCloseTo(0.865, 3)
  })

  it('gives the 2 in tile its modules on the beta’s real address (version 9: 0.833 mm) and the fixture host (version 8: 0.891 mm)', () => {
    expect(codeModuleMm(inToPt(2), modulesOf(BETA_ADDRESS))).toBeCloseTo(0.833, 3)
    expect(codeModuleMm(inToPt(2), modulesOf(FIXTURE_ADDRESS))).toBeCloseTo(0.891, 3)
  })

  it('sets the floor within 5 % of what ships today and a hair under Mini’s 0.858 mm', () => {
    expect(CODE_MODULE_MIN_MM).toBe(0.85)
    expect(CODE_MODULE_MIN_MM).toBeGreaterThan(0.891 * 0.95)
    expect(CODE_MODULE_MIN_MM).toBeLessThan(codeModuleMm(mmToPt(31.75), 29))
  })
})

describe('chooseCodeTile', () => {
  const choose = (
    size: PrintKitSize,
    paper: PrintKitPaper,
    address: string,
    addressShape: PrintAddressShape,
  ) => chooseCodeTile({ size, paper, symbolModules: modulesOf(address), addressShape })

  describe('with the beta’s real address, a long one (version 9)', () => {
    it.each(PRINT_KIT_PAPERS)(
      'keeps Large on today’s 2 in tile on %s, 0.833 mm and never refused',
      (paper) => {
        const result = choose('large', paper, BETA_ADDRESS, 'long')
        expect(result.isOk()).toBe(true)
        const choice = result._unsafeUnwrap()
        expect(choice.tile).toBe(TODAY_CODE_TILE)
        expect(choice.moduleMm).toBeCloseTo(0.833, 3)
        expect(choice.moduleMm).toBeLessThan(CODE_MODULE_MIN_MM)
      },
    )

    it.each(PRINT_KIT_PAPERS)(
      'refuses Table and Mini on %s: they need a short code',
      (paper) => {
        for (const size of ['table', 'mini'] as const) {
          const error = choose(size, paper, BETA_ADDRESS, 'long')._unsafeUnwrapErr()
          expect(error).toMatchObject({
            code: 'print_code_too_small',
            cause: 'needs_short_code',
            size,
          })
          expect(error.moduleMm).toBeLessThan(CODE_MODULE_MIN_MM)
        }
      },
    )
  })

  describe('with a long address on the fixture host (version 8)', () => {
    it('falls back from 1.75 in to 2 in on Large, because 0.78 mm is under the floor', () => {
      const choice = choose('large', 'letter', FIXTURE_ADDRESS, 'long')._unsafeUnwrap()
      expect(choice.tile.tilePt).toBe(inToPt(2))
      expect(choice.moduleMm).toBeCloseTo(0.891, 3)
      expect(choice.moduleMm).toBeGreaterThanOrEqual(CODE_MODULE_MIN_MM)
    })
  })

  describe('with the short print address (version 3)', () => {
    it.each(PRINT_KIT_PAPERS)(
      'lets every size print on %s, Large on its 1.75 in tile',
      (paper) => {
        for (const size of PRINT_KIT_SIZES) {
          const choice = choose(size, paper, SHORT_ADDRESS, 'short')._unsafeUnwrap()
          expect(choice.tile).toBe(tileOf(size, paper))
          expect(choice.moduleMm).toBeGreaterThanOrEqual(CODE_MODULE_MIN_MM)
        }
      },
    )

    it('puts Large at 1.201 mm, Table at 0.961 mm (0.973 in Europe) and Mini at 0.858 mm (0.865 in Europe)', () => {
      const moduleOf = (size: PrintKitSize, paper: PrintKitPaper) =>
        choose(size, paper, SHORT_ADDRESS, 'short')._unsafeUnwrap().moduleMm
      expect(moduleOf('large', 'letter')).toBeCloseTo(1.201, 3)
      expect(moduleOf('table', 'letter')).toBeCloseTo(0.961, 3)
      expect(moduleOf('table', 'a4')).toBeCloseTo(0.973, 3)
      expect(moduleOf('mini', 'letter')).toBeCloseTo(0.858, 3)
      expect(moduleOf('mini', 'a4')).toBeCloseTo(0.865, 3)
    })
  })

  describe('with a short code on a print host that is too long (version 4)', () => {
    it.each(PRINT_KIT_PAPERS)(
      'still prints Large and Table on %s but refuses Mini, and says the host is the cause',
      (paper) => {
        expect(choose('large', paper, LONG_HOST_SHORT_CODE, 'short').isOk()).toBe(true)
        const table = choose(
          'table',
          paper,
          LONG_HOST_SHORT_CODE,
          'short',
        )._unsafeUnwrap()
        expect(table.moduleMm).toBeGreaterThanOrEqual(CODE_MODULE_MIN_MM)
        const error = choose(
          'mini',
          paper,
          LONG_HOST_SHORT_CODE,
          'short',
        )._unsafeUnwrapErr()
        expect(error).toMatchObject({
          code: 'print_code_too_small',
          cause: 'address_host_too_long',
          size: 'mini',
        })
        expect(error.moduleMm).toBeCloseTo(paper === 'letter' ? 0.774 : 0.78, 2)
      },
    )
  })

  describe('Large’s two tiles', () => {
    const choiceAt = (symbolModules: number) =>
      chooseCodeTile({
        size: 'large',
        paper: 'letter',
        symbolModules,
        addressShape: 'long',
      })._unsafeUnwrap()

    it('keeps 1.75 in up to a symbol of 41 modules (version 6) and takes 2 in from 45 (version 7)', () => {
      expect(choiceAt(41).tile.tilePt).toBe(inToPt(1.75))
      expect(choiceAt(41).moduleMm).toBeCloseTo(0.907, 3)
      expect(choiceAt(45).tile.tilePt).toBe(inToPt(2))
      expect(choiceAt(45).moduleMm).toBeCloseTo(0.958, 3)
    })

    it('is never refused, at any version a QR code has', () => {
      for (let version = 1; version <= 40; version += 1) {
        const result = chooseCodeTile({
          size: 'large',
          paper: 'letter',
          symbolModules: 17 + 4 * version,
          addressShape: 'long',
        })
        expect(result.isOk()).toBe(true)
      }
    })
  })

  it('accepts Table and Mini exactly when the module reaches the floor, at every version', () => {
    for (const size of ['table', 'mini'] as const) {
      for (const paper of PRINT_KIT_PAPERS) {
        for (let version = 1; version <= 40; version += 1) {
          const symbolModules = 17 + 4 * version
          const wide = ptToMm(tileOf(size, paper).tilePt) / (symbolModules + 8)
          const result = chooseCodeTile({
            size,
            paper,
            symbolModules,
            addressShape: 'short',
          })
          expect(result.isOk()).toBe(wide >= CODE_MODULE_MIN_MM)
        }
      }
    }
  })

  it('names the cause by the address’s shape alone: long needs a short code, short blames the host', () => {
    const base = { size: 'mini', paper: 'letter', symbolModules: 53 } as const
    expect(
      chooseCodeTile({ ...base, addressShape: 'long' })._unsafeUnwrapErr().cause,
    ).toBe('needs_short_code')
    expect(
      chooseCodeTile({ ...base, addressShape: 'short' })._unsafeUnwrapErr().cause,
    ).toBe('address_host_too_long')
  })
})

describe('the cue on a small tile', () => {
  const cueWidth = (locale: GuestLocale, sizePt: number) =>
    estimatedCueWidthPt({ text: PRINT_KIT_SCAN_CUE[locale], locale }, sizePt)

  it('has the room the spec-delta measured: 99 pt beside Large’s pictogram, 96 pt on Table, 86 pt on Mini', () => {
    expect(codeTileCueRoomPt(tileOf('large', 'letter'), 'one')).toBeCloseTo(99.36, 2)
    expect(codeTileCueRoomPt(tileOf('table', 'letter'), 'one')).toBeCloseTo(96.48, 2)
    expect(codeTileCueRoomPt(tileOf('table', 'a4'), 'one')).toBeCloseTo(97.73, 2)
    expect(codeTileCueRoomPt(tileOf('mini', 'letter'), 'one')).toBeCloseTo(85.68, 2)
  })

  it('sets the English and Bulgarian cues on one line on every size, as the spec-delta says', () => {
    for (const paper of PRINT_KIT_PAPERS) {
      for (const size of PRINT_KIT_SIZES) {
        const tile = tileOf(size, paper)
        for (const locale of ['en', 'bg'] as const) {
          expect(cueWidth(locale, tile.cuePt.one)).toBeLessThanOrEqual(
            codeTileCueRoomPt(tile, 'one'),
          )
        }
      }
    }
  })

  // The spec-delta measured only English, Bulgarian and Spanish. The cue copy has
  // six languages, and the longest two (Italian 102.6 pt and French 112 pt at 9 pt)
  // do not fit a tile that has no pictogram to move: this pins the gap, so Table
  // and Mini are not switched on for those languages blind. Large copes, because
  // its pictogram moves above the line (`planCodeBlock`).
  it.each([
    ['table', 'letter', { en: true, es: true, bg: true, de: true, it: false, fr: false }],
    ['table', 'a4', { en: true, es: true, bg: true, de: true, it: false, fr: false }],
    ['mini', 'letter', { en: true, es: true, bg: true, de: true, it: false, fr: false }],
    ['mini', 'a4', { en: true, es: true, bg: true, de: true, it: false, fr: false }],
  ] as const)(
    'fits the %s %s tile’s cue on one line for these languages only: %j',
    (size, paper, fits) => {
      const tile = tileOf(size, paper)
      for (const locale of GUEST_LOCALES) {
        const fitsOneLine =
          cueWidth(locale, tile.cuePt.one) <= codeTileCueRoomPt(tile, 'one')
        expect(fitsOneLine, `${locale} on ${size} ${paper}`).toBe(fits[locale])
      }
    },
  )
})

describe('printAddressShape', () => {
  it('reads the print host and a 20-character print code as short, in either case', () => {
    expect(printAddressShape(SHORT_ADDRESS)).toBe('short')
    expect(printAddressShape(SHORT_ADDRESS.toLowerCase())).toBe('short')
    expect(printAddressShape(LONG_HOST_SHORT_CODE)).toBe('short')
  })

  it('reads the whole token with its marker as long, on any host', () => {
    expect(printAddressShape(BETA_ADDRESS)).toBe('long')
    expect(printAddressShape(FIXTURE_ADDRESS)).toBe('long')
  })

  it('reads anything else as long: a query, a code of another length, a letter Crockford leaves out, not a URL', () => {
    expect(printAddressShape(`${SHORT_ADDRESS}?accessArtifact=${MARKER}`)).toBe('long')
    expect(printAddressShape(SHORT_ADDRESS.slice(0, -1))).toBe('long')
    expect(printAddressShape(`HTTPS://AP.UP.RAILWAY.APP/p/${'U'.repeat(20)}`)).toBe(
      'long',
    )
    expect(printAddressShape('not an address')).toBe('long')
  })
})
