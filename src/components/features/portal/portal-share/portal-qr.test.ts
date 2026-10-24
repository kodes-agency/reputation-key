// The portal's code as a file: the quiet zone round the symbol, the two
// download formats, and the names they save under.
//
// A printed code is scanned off a table tent in a dim restaurant, so the parts
// worth pinning are the ones that decide whether a phone can read it: a quiet
// zone of four modules on every side (the QR specification's minimum), whole
// pixels per module in the PNG (no blur at the module edges), and a vector file
// that carries no script.

import { describe, expect, it } from 'vitest'
import {
  PNG_PIXELS_PER_MODULE,
  QR_ERROR_CORRECTION,
  QR_QUIET_ZONE_MODULES,
  qrDownloadFileName,
  renderQrPngDataUrl,
  renderQrPreviewDataUrl,
  renderQrSvg,
} from './portal-qr'

const ADDRESS = 'https://portal.example/p/opaque-token-shown-once'

/** The number of modules along one side, read from the SVG's viewBox. */
function svgSideInModules(svg: string): number {
  const match = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)
  expect(match).not.toBeNull()
  expect(match?.[1]).toBe(match?.[2])
  return Number(match?.[1])
}

type DarkRun = Readonly<{ x: number; length: number; y: number }>

/**
 * Every dark horizontal run in the SVG path. The path is an absolute `M<x> <y>`
 * start followed by `h<n>` runs and relative `m<dx> <dy>` moves, so the right-hand
 * edge of a run is only known by walking the commands.
 */
function darkRuns(svg: string): readonly DarkRun[] {
  const path = /<path stroke="[^"]+" d="([^"]+)"/.exec(svg)?.[1] ?? ''
  const runs: DarkRun[] = []
  let x = 0
  let y = 0
  for (const [, command, first, second] of path.matchAll(
    /([Mmh])(-?\d+(?:\.\d+)?)(?: (-?\d+(?:\.\d+)?))?/g,
  )) {
    const a = Number(first)
    if (command === 'M') [x, y] = [a, Number(second)]
    else if (command === 'm') [x, y] = [x + a, y + Number(second)]
    else {
      runs.push({ x, length: a, y })
      x += a
    }
  }
  return runs
}

function pngWidth(dataUrl: string): number {
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
  return bytes.readUInt32BE(16)
}

describe('portal code rendering', () => {
  it('leaves a quiet zone of four modules, the specification minimum', () => {
    expect(QR_QUIET_ZONE_MODULES).toBe(4)
  })

  it('draws the SVG with four modules of quiet zone on each side', async () => {
    const svg = await renderQrSvg(ADDRESS)
    const bare = await renderQrSvg(ADDRESS, 0)

    expect(svgSideInModules(svg) - svgSideInModules(bare)).toBe(2 * 4)
    // A version N symbol is 17 + 4N modules wide: the symbol itself is intact.
    expect((svgSideInModules(bare) - 17) % 4).toBe(0)
  })

  it('draws no dark module inside the quiet zone, on any of the four sides', async () => {
    const svg = await renderQrSvg(ADDRESS)
    const side = svgSideInModules(svg)
    const runs = darkRuns(svg)
    expect(runs.length).toBeGreaterThan(0)
    for (const { x, length, y } of runs) {
      expect(x).toBeGreaterThanOrEqual(QR_QUIET_ZONE_MODULES)
      expect(x + length).toBeLessThanOrEqual(side - QR_QUIET_ZONE_MODULES)
      expect(y).toBeGreaterThanOrEqual(QR_QUIET_ZONE_MODULES)
      expect(y).toBeLessThanOrEqual(side - QR_QUIET_ZONE_MODULES)
    }
  })

  it("draws the SVG in the colours it is asked for, the print kit preview's own paper and ink", async () => {
    const svg = await renderQrSvg(ADDRESS, QR_QUIET_ZONE_MODULES, {
      dark: '#121614',
      light: '#f6f1e6',
    })
    expect(svg).toMatch(/#121614/iu)
    expect(svg).toMatch(/#f6f1e6/iu)
    expect(await renderQrSvg(ADDRESS)).not.toMatch(/#121614/iu)
  })

  it('returns a standalone vector file with no script in it', async () => {
    const svg = await renderQrSvg(ADDRESS)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).not.toMatch(/<script|onload|href=/i)
  })

  it('renders the PNG in whole pixels per module, quiet zone included', async () => {
    const dataUrl = await renderQrPngDataUrl(ADDRESS)
    const modules = svgSideInModules(await renderQrSvg(ADDRESS))

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(pngWidth(dataUrl)).toBe(modules * PNG_PIXELS_PER_MODULE)
    // Large enough to print at table-tent size without the modules blurring.
    expect(pngWidth(dataUrl)).toBeGreaterThanOrEqual(800)
  })

  it('renders a smaller PNG for the on-screen preview', async () => {
    const preview = await renderQrPreviewDataUrl(ADDRESS)
    expect(pngWidth(preview)).toBeLessThan(pngWidth(await renderQrPngDataUrl(ADDRESS)))
  })
})

// The short print address (ADR 0069) is a version 3 symbol, 29 modules, at error
// correction M and in no other way: Q makes it version 4. The downloads, the
// preview and the print kit's PDF must all draw the same symbol, so the level is
// said, not defaulted.
describe('the short print address', () => {
  const SHORT = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'

  it('draws error correction M, named and not left to the library', () => {
    expect(QR_ERROR_CORRECTION).toBe('M')
  })

  it('is a version 3 symbol in the SVG, 29 modules, 37 with the quiet zone', async () => {
    const svg = await renderQrSvg(SHORT)
    expect(svgSideInModules(svg)).toBe(37)
    expect(svgSideInModules(await renderQrSvg(SHORT, 0))).toBe(29)
  })

  it('is the same symbol in the PNG', async () => {
    const dataUrl = await renderQrPngDataUrl(SHORT)
    expect(pngWidth(dataUrl)).toBe(37 * PNG_PIXELS_PER_MODULE)
  })

  it('is a version 4 symbol in lowercase, which is why the address is drawn in capitals', async () => {
    expect(svgSideInModules(await renderQrSvg(SHORT.toLowerCase(), 0))).toBe(33)
  })
})

describe('qrDownloadFileName', () => {
  it('slugs the portal name and names the format', () => {
    expect(qrDownloadFileName('Pool & Terrace', 'png')).toBe('pool-terrace-code.png')
    expect(qrDownloadFileName('  Front desk  ', 'svg')).toBe('front-desk-code.svg')
  })

  it('falls back to a plain name when the portal name has no letters or digits', () => {
    expect(qrDownloadFileName('***', 'png')).toBe('portal-code.png')
    expect(qrDownloadFileName('', 'svg')).toBe('portal-code.svg')
  })

  it('keeps the letters of any script, so a Cyrillic name is not lost to the fallback', () => {
    expect(qrDownloadFileName('Бар на терасата', 'png')).toBe('бар-на-терасата-code.png')
    expect(qrDownloadFileName('Café Müller', 'svg')).toBe('café-müller-code.svg')
  })

  it('never lets a name break out of a file name', () => {
    expect(qrDownloadFileName('../../etc/passwd', 'png')).toBe('etc-passwd-code.png')
  })
})
