// Which of the guest font files carries a character.
//
// The guest fonts are Fontsource's four subsets per face (latin, latin-ext,
// cyrillic, cyrillic-ext), so no single file holds a bilingual line: the
// Cyrillic subset has no space or digit. The browser picks a file per
// character from each `@font-face`'s `unicode-range`; a PDF has no such
// fallback, so the print kit does the same split itself, from the same table.
// `print-kit-font-ranges.test.ts` reads `public/fonts/guest/guest-fonts.css`
// and fails when this table drifts from it.

export type FontSubset = 'latin' | 'latin-ext' | 'cyrillic' | 'cyrillic-ext'

type CodePointRange = readonly [from: number, to: number]

export const FONT_SUBSET_RANGES: Readonly<Record<FontSubset, readonly CodePointRange[]>> =
  Object.freeze({
    latin: [
      [0x0000, 0x00ff],
      [0x0131, 0x0131],
      [0x0152, 0x0153],
      [0x02bb, 0x02bc],
      [0x02c6, 0x02c6],
      [0x02da, 0x02da],
      [0x02dc, 0x02dc],
      [0x0304, 0x0304],
      [0x0308, 0x0308],
      [0x0329, 0x0329],
      [0x2000, 0x206f],
      [0x20ac, 0x20ac],
      [0x2122, 0x2122],
      [0x2191, 0x2191],
      [0x2193, 0x2193],
      [0x2212, 0x2212],
      [0x2215, 0x2215],
      [0xfeff, 0xfeff],
      [0xfffd, 0xfffd],
    ],
    'latin-ext': [
      [0x0100, 0x02ba],
      [0x02bd, 0x02c5],
      [0x02c7, 0x02cc],
      [0x02ce, 0x02d7],
      [0x02dd, 0x02ff],
      [0x0304, 0x0304],
      [0x0308, 0x0308],
      [0x0329, 0x0329],
      [0x1d00, 0x1dbf],
      [0x1e00, 0x1e9f],
      [0x1ef2, 0x1eff],
      [0x2020, 0x2020],
      [0x20a0, 0x20ab],
      [0x20ad, 0x20c0],
      [0x2113, 0x2113],
      [0x2c60, 0x2c7f],
      [0xa720, 0xa7ff],
    ],
    cyrillic: [
      [0x0301, 0x0301],
      [0x0400, 0x045f],
      [0x0490, 0x0491],
      [0x04b0, 0x04b1],
      [0x2116, 0x2116],
    ],
    'cyrillic-ext': [
      [0x0460, 0x052f],
      [0x1c80, 0x1c8a],
      [0x20b4, 0x20b4],
      [0x2de0, 0x2dff],
      [0xa640, 0xa69f],
      [0xfe2e, 0xfe2f],
    ],
  })

/**
 * Tried in this order, so a code point in two ranges (the combining marks, in
 * both Latin subsets) goes to the first, and the base letters stay together.
 */
const SUBSET_ORDER: readonly FontSubset[] = [
  'latin',
  'latin-ext',
  'cyrillic',
  'cyrillic-ext',
]

export function subsetOfCodePoint(codePoint: number): FontSubset | null {
  return (
    SUBSET_ORDER.find((subset) =>
      FONT_SUBSET_RANGES[subset].some(
        ([from, to]) => codePoint >= from && codePoint <= to,
      ),
    ) ?? null
  )
}

export type FontRun = Readonly<{ subset: FontSubset; text: string }>

/**
 * The text as consecutive runs, each in the one subset that carries it.
 * Characters no subset carries (a symbol, a script the six guest languages do
 * not use) are not in any run: use `stripUnsupportedCharacters` first when the
 * text came from a person.
 */
export function splitIntoFontRuns(text: string): readonly FontRun[] {
  const runs: { subset: FontSubset; text: string }[] = []
  for (const character of text) {
    const subset = subsetOfCodePoint(character.codePointAt(0) ?? 0)
    if (subset === null) continue
    const last = runs.at(-1)
    if (last?.subset === subset) last.text += character
    else runs.push({ subset, text: character })
  }
  return runs
}

/** The text without the characters no guest font carries. */
export function stripUnsupportedCharacters(text: string): string {
  return [...text]
    .filter((character) => subsetOfCodePoint(character.codePointAt(0) ?? 0) !== null)
    .join('')
}
