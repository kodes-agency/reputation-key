// The widths of the print kit's words, estimated without the fonts (spec 2.2):
// the Share tab's preview cannot measure Cormorant Garamond and Ysabeau Office as
// the PDF does, so it reads each character's advance from these tables. They
// were measured from the files the PDF embeds (lining figures on the display
// face, the wider of Ysabeau's 400 and 600 for the text), rounded up to the next
// hundredth of an em, so an estimate errs wide: the preview may set a line a
// little smaller than the file prints it, never larger, as the code block's cue
// table does (`portal-print-kit-code-block.ts`). An accented letter reads its
// base letter's width unless it is listed; a character in neither table reads a
// wide default.
//
// A test measures every listed character with the fonts and fails when a table
// says less than the font does.

/** Thousandths of an em, and the characters that advance that far. */
type WidthTable = Readonly<Record<number, string>>

/** Cormorant Garamond 600, with lining figures. */
const DISPLAY_WIDTHS: WidthTable = {
  150: "'",
  170: '|',
  190: '’‘',
  200: '·',
  210: '.:',
  220: '`',
  230: ',;',
  240: ' \u00a0',
  260: '!',
  270: 'ijl',
  280: '[]',
  290: '{}',
  300: '"',
  310: '()f',
  330: '-',
  340: '?IJstг',
  350: '/\\',
  360: '“”',
  380: 'r',
  400: '1+^_',
  410: '<>zз',
  420: 'aceаесь',
  430: '7yуя',
  440: '3vxх',
  450: '25*g~лч',
  470: '=д',
  480: '4к',
  490: '9oбвоъ',
  500: '68kqц',
  510: '0Shuи',
  520: '$Fbdp–р',
  530: '#nГЗнп',
  550: 'ELPЕР',
  560: 'ß',
  570: 'Ьм',
  580: '%',
  590: 'BБВ',
  610: 'Z',
  620: 'YУЯ',
  640: 'TТЧ',
  650: 'XХ',
  660: 'Kф',
  670: 'VКСЪ',
  680: 'w…',
  690: 'CRю',
  700: 'Dж',
  710: '&U',
  720: 'AАДЛ',
  730: '@G',
  740: 'NЦ',
  750: 'П',
  770: 'HOQИНОшщ',
  780: 'mт',
  830: '—',
  840: 'Ф',
  850: 'MМ',
  920: 'W',
  1010: 'Ж',
  1050: 'Ю',
  1060: 'ШЩ',
}

/** Ysabeau Office, the wider of 400 and 600. */
const TEXT_WIDTHS: WidthTable = {
  250: ' \u00a0',
  260: '.:l·',
  270: "'ij’‘",
  280: ',`',
  290: ';',
  300: '!',
  320: 'J',
  330: 'I',
  360: 'f',
  370: '?[]',
  380: '-rг',
  390: '()/\\st',
  400: '|',
  430: '^z{}ь',
  450: 'cс',
  460: '"aevx“”àäаех',
  470: 'зл',
  480: '*kyку',
  490: 'чъя',
  500: 'g',
  520: '0123456789Гв',
  530: '$Souùúûüбино',
  540: '<>dnpqдпр',
  550: '+=F_bh~–ßц',
  560: 'LЗ',
  580: 'EЕ',
  590: 'BВ',
  600: 'PБРЬ',
  610: 'ф',
  620: 'Zм',
  630: 'TТ',
  640: 'KXYКХЯ',
  650: '#',
  660: 'CС',
  680: '%RЛ',
  690: 'AVАУЧж',
  700: '&',
  710: 'Ъ',
  720: 'ю',
  730: 'Gw…',
  740: 'DU',
  750: 'П',
  770: 'HН',
  780: 'NИ',
  790: 'ДЦ',
  800: 'OQmОтш',
  820: 'щ',
  870: 'Ф',
  880: '@',
  900: '—',
  920: 'MМ',
  980: 'Ж',
  990: 'W',
  1020: 'Ш',
  1040: 'Ю',
  1060: 'Щ',
}

/**
 * Ysabeau Office 400 and 600 italic, where the wider of the two sets wider than
 * the text table says: the final kit's second-language line, semibold where it
 * is reversed under 9 pt. Every other character reads the text table.
 */
const ITALIC_WIDER: WidthTable = {
  270: 'l.:',
  340: 'J',
  380: '?',
  400: '/r',
  410: '\\',
  470: 'v',
  510: 'kл',
  520: 'aàáâäа',
  540: '$',
  580: '+',
  590: '=',
  620: 'ф',
  650: 'TТ',
  660: 'KКм',
  720: 'ж',
  780: '&',
}

/** A character in neither table: wider than any lowercase letter. */
const UNLISTED_EM = 0.8

export type EstimatedFace = 'display' | 'text' | 'italic'

const byCharacter = (table: WidthTable): ReadonlyMap<string, number> =>
  new Map(
    Object.entries(table).flatMap(([width, characters]) =>
      [...characters].map((character) => [character, Number(width) / 1000] as const),
    ),
  )

const ADVANCES: Readonly<Record<EstimatedFace, ReadonlyMap<string, number>>> = {
  display: byCharacter(DISPLAY_WIDTHS),
  text: byCharacter(TEXT_WIDTHS),
  italic: new Map([...byCharacter(TEXT_WIDTHS), ...byCharacter(ITALIC_WIDER)]),
}

/** One character's advance in ems, erring wide. */
export function estimatedAdvanceEm(face: EstimatedFace, character: string): number {
  const advances = ADVANCES[face]
  const base = character.normalize('NFD').charAt(0)
  return advances.get(character) ?? advances.get(base) ?? UNLISTED_EM
}

/**
 * The width of a line of `text` at `sizePt`, in points, tracked by `trackingEm`
 * after every character but the last, as the PDF measures a line.
 */
export function estimatedLineWidthPt(
  text: string,
  face: EstimatedFace,
  sizePt: number,
  trackingEm = 0,
): number {
  const characters = [...text]
  const advance = characters.reduce(
    (sum, character) => sum + estimatedAdvanceEm(face, character),
    0,
  )
  return sizePt * (advance + Math.max(0, characters.length - 1) * trackingEm)
}
