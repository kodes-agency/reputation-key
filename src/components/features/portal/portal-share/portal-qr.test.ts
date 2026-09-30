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

describe('qrDownloadFileName', () => {
  it('slugs the portal name and names the format', () => {
    expect(qrDownloadFileName('Pool & Terrace', 'png')).toBe('pool-terrace-code.png')
    expect(qrDownloadFileName('  Front desk  ', 'svg')).toBe('front-desk-code.svg')
  })

  it('falls back to a plain name when the portal name has no letters or digits', () => {
    expect(qrDownloadFileName('***', 'png')).toBe('portal-code.png')
    expect(qrDownloadFileName('', 'svg')).toBe('portal-code.svg')
  })

  it('drops accents and non-Latin names to the plain fallback, never a mangled path', () => {
    expect(qrDownloadFileName('Бар на терасата', 'png')).toBe('portal-code.png')
    expect(qrDownloadFileName('../../etc/passwd', 'png')).toBe('etc-passwd-code.png')
  })
})
