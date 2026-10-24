// How high and how deep a line's ink reaches, estimated without the fonts, for
// the Share tab's preview of the final print kit: the preview places each part
// by its ink, as the PDF does, but cannot read the glyph outlines. Each listed
// character's reach was measured from the files the PDF embeds (Cormorant
// Garamond 600 with lining figures; for the sans, the highest and deepest of
// Ysabeau Office 400, 600 and 400 italic), rounded up to the next hundredth of an
// em, so an estimate is never short. A character not listed (an accented or a
// Cyrillic letter) reads the family's ascender and its deepest descender.
//
// A test measures every listed character with the fonts and fails when a table
// says less than the font does.

import type { PrintFinalFamily } from '#/shared/domain/portal-print-final-type'

/** Thousandths of an em, and the characters that reach that far. */
type ReachTable = Readonly<Record<number, string>>

const SERIF_UP: ReachTable = {
  0: '_ ',
  100: ',.…',
  220: '–—',
  250: '~',
  260: '-·',
  290: '=',
  360: '+<>',
  380: ':;',
  390: 'vwxy',
  400: 'acegmnopqrsu',
  430: 'z',
  460: 't',
  490: '#',
  500: '@',
  560: '%',
  610: 'ij',
  630: '!?BDEFHIJKLMNPRUVWXY’”',
  640: '"\'01234689ACGOQS^‘“',
  650: '&',
  660: '57TZ',
  690: '*',
  730: '$()[]bdfhkl{}',
  740: '/\\`|',
}

const SERIF_DOWN: ReachTable = {
  0: ' "\'*+-1247<=>AEFHILMPRTXY^`fhiklmnrxz~’‘“”–—·',
  10: '%BDKVWZavw',
  20: '!&.035689:?CGNOSUbcdeostu…',
  80: '_',
  90: '#',
  110: '@',
  120: '$()[]{}',
  170: '/\\|',
  190: ',;',
  200: 'Q',
  250: 'J',
  280: 'pq',
  290: 'gjy',
}

const SANS_UP: ReachTable = {
  0: '_ ',
  130: ',.…',
  270: '-–—',
  300: '·',
  310: '~',
  360: '=',
  410: ':;',
  420: 'xz',
  430: 'acegmnoqruvwy',
  440: 's',
  460: '<>',
  470: '+',
  480: 'p',
  520: 't',
  580: '#',
  610: '@',
  620: '%',
  650: 'ij',
  660: '!"\'17ABDEFHIJKLMNPRTUVWXYZ‘“',
  670: '02345689?CGOQS^’”',
  700: '&',
  710: '`',
  720: '()[\\]bdfhkl{|}',
  730: '*/',
  770: '$',
}

const SANS_DOWN: ReachTable = {
  0: ' "\'*+-1247<=>ABDEFHIKLMNPTVWXYZ^`r~’‘“”–—·',
  10: '!%&.035689:?Rabdhiklmntuvwx…',
  20: 'CGOSUceosz',
  70: '#',
  120: '$',
  140: '_',
  180: '@Q',
  200: ',;',
  210: 'J',
  230: '()/[\\]{|}',
  290: 'fgjpqy',
}

const byCharacter = (table: ReachTable): ReadonlyMap<string, number> =>
  new Map(
    Object.entries(table).flatMap(([reach, characters]) =>
      [...characters].map((character) => [character, Number(reach) / 1000] as const),
    ),
  )

const REACH: Readonly<
  Record<
    PrintFinalFamily,
    Readonly<{
      up: ReadonlyMap<string, number>
      down: ReadonlyMap<string, number>
      /** What an unlisted character reaches: the line box's ascender, and the deepest descender. */
      ascender: number
      descender: number
    }>
  >
> = {
  serif: {
    up: byCharacter(SERIF_UP),
    down: byCharacter(SERIF_DOWN),
    ascender: 0.924,
    descender: 0.29,
  },
  sans: {
    up: byCharacter(SANS_UP),
    down: byCharacter(SANS_DOWN),
    ascender: 1.054,
    descender: 0.29,
  },
}

/** How far one character's ink reaches above and below the baseline, in ems, erring far. */
export function estimatedReachEm(
  family: PrintFinalFamily,
  character: string,
): Readonly<{ up: number; down: number }> {
  const reach = REACH[family]
  return {
    up: reach.up.get(character) ?? reach.ascender,
    down: reach.down.get(character) ?? reach.descender,
  }
}

/** A line's reach: its highest and its deepest character's. */
export function estimatedLineReachEm(
  family: PrintFinalFamily,
  text: string,
): Readonly<{ up: number; down: number }> {
  return [...text].reduce(
    (line, character) => {
      const one = estimatedReachEm(family, character)
      return { up: Math.max(line.up, one.up), down: Math.max(line.down, one.down) }
    },
    { up: 0, down: 0 },
  )
}
