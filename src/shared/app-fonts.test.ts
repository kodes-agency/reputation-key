// The self-hosted app fonts (Plus Jakarta Sans, JetBrains Mono) are vendored
// files behind one stylesheet. This keeps the stylesheet and the folder in step:
// every file it names exists, every family carries its licence, and nothing in
// it reaches a third-party host. Satoshi is never vendored (see font-sets.ts).

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..')
const FONT_DIRECTORY = join(ROOT, 'public/fonts/app')
// A `new URL(…, import.meta.url)` read, so the dead-code audit sees that the
// stylesheet is used (the app links it by URL from font-sets.ts).
const css = readFileSync(
  new URL('../../public/fonts/app/app-fonts.css', import.meta.url),
  'utf8',
)

const referencedFiles = [
  ...css.matchAll(/url\((\/fonts\/app\/[^)]+)\)\s*format\('woff2'\)/g),
].map((match) => match[1] ?? '')

function blocksOf(family: string): readonly string[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)]
    .map((match) => match[1] ?? '')
    .filter((body) => body.includes(`font-family: '${family}';`))
}

describe('the vendored app fonts', () => {
  it('has every woff2 the stylesheet references on disk', () => {
    expect(referencedFiles.length).toBeGreaterThan(0)
    for (const path of referencedFiles) {
      expect(existsSync(join(ROOT, 'public', path)), path).toBe(true)
    }
  })

  it('references every woff2 in the folder, so no unused file is shipped', () => {
    const onDisk = readdirSync(FONT_DIRECTORY).filter((name) => name.endsWith('.woff2'))
    expect([...onDisk].sort()).toEqual(
      referencedFiles.map((path) => path.replace('/fonts/app/', '')).sort(),
    )
  })

  it('ships no Satoshi file, whose licence forbids redistributing it', () => {
    expect(readdirSync(FONT_DIRECTORY).some((name) => /satoshi/i.test(name))).toBe(false)
    expect(blocksOf('Satoshi')).toHaveLength(0)
  })

  it('ships the licence of both families beside the files', () => {
    for (const name of ['plus-jakarta-sans', 'jetbrains-mono']) {
      const licence = readFileSync(join(FONT_DIRECTORY, `OFL-${name}.txt`), 'utf8')
      expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1')
    }
  })

  it('covers each weight in every subset the family ships, each behind a unicode range', () => {
    const wanted: Record<string, { weights: number[]; subsets: string[] }> = {
      'Plus Jakarta Sans': {
        weights: [500, 600, 700],
        subsets: ['latin', 'latin-ext', 'cyrillic-ext', 'vietnamese'],
      },
      'JetBrains Mono': {
        weights: [400, 500],
        subsets: [
          'latin',
          'latin-ext',
          'cyrillic',
          'cyrillic-ext',
          'greek',
          'vietnamese',
        ],
      },
    }
    for (const [family, { weights, subsets }] of Object.entries(wanted)) {
      const found = blocksOf(family).map((body) => {
        const weight = /font-weight:\s*(\d+);/.exec(body)?.[1]
        const subset =
          /-(latin-ext|latin|cyrillic-ext|cyrillic|greek|vietnamese)-\d+-normal\.woff2/.exec(
            body,
          )?.[1]
        expect(body).toMatch(/font-display:\s*swap;/)
        expect(body).toMatch(/unicode-range:\s*U\+/)
        return `${weight}|${subset}`
      })
      const expected = weights.flatMap((weight) =>
        subsets.map((subset) => `${weight}|${subset}`),
      )
      expect([...found].sort(), family).toEqual([...expected].sort())
    }
  })

  it('never reaches a third-party host', () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/https?:\/\/|@import/)
  })

  it('adjusts a local fallback face to each web font, so text does not jump when it loads', () => {
    const families = [
      'Satoshi Fallback',
      'Plus Jakarta Sans Fallback',
      'JetBrains Mono Fallback',
    ]
    for (const family of families) {
      const blocks = blocksOf(family)
      expect(blocks.length, family).toBeGreaterThan(0)
      for (const body of blocks) {
        expect(body).toMatch(/src:\s*local\(/)
        expect(body).toMatch(/size-adjust:\s*\d/)
        expect(body).toMatch(/ascent-override:\s*\d/)
        expect(body).toMatch(/descent-override:\s*\d/)
        expect(body).toMatch(/line-gap-override:\s*\d/)
      }
    }
  })
})
