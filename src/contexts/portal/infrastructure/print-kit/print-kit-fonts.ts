// The guest fonts, bundled into the server so a PDF can embed them.
//
// They are the faces and subsets guest pages serve from `public/fonts/guest/`
// (Cormorant Garamond 600 for display, Ysabeau Office 400 and 600 for text),
// as TrueType in `./fonts/`. The woff2 files cannot be embedded: fontkit, which
// PDFKit embeds fonts with, mis-reads the transformed `glyf` table of a woff2
// font. Ysabeau fails to subset at all (an accented letter, a quotation mark
// or an `i` raises "Offset is outside the bounds of the DataView"), and
// Cormorant subsets without an error and draws its headlines as shapeless
// blobs. The .ttf files are a lossless format conversion of the same woff2
// files, made with `fontTools` (`font = TTFont(source); font.flavor = None;
// font.save(target)`). Both families are licensed under the SIL OFL 1.1; the
// licences sit beside the files. The test beside this file embeds every
// character of every subset, so a change of font that breaks embedding fails
// here and not on a manager's download.
//
// They are imported as data URIs, not read from disk at run time: the web image
// carries no source tree, and the built server resolves nothing but what it
// bundled. Decoding is lazy, so a process that never makes a print kit pays for
// the strings only.

import { Buffer } from 'node:buffer'
import type { FontSubset } from './print-kit-font-ranges'

import display_latin from './fonts/cormorant-garamond-latin-600-normal.ttf?inline'
import display_latin_ext from './fonts/cormorant-garamond-latin-ext-600-normal.ttf?inline'
import display_cyrillic from './fonts/cormorant-garamond-cyrillic-600-normal.ttf?inline'
import display_cyrillic_ext from './fonts/cormorant-garamond-cyrillic-ext-600-normal.ttf?inline'
import body_latin from './fonts/ysabeau-office-latin-400-normal.ttf?inline'
import body_latin_ext from './fonts/ysabeau-office-latin-ext-400-normal.ttf?inline'
import body_cyrillic from './fonts/ysabeau-office-cyrillic-400-normal.ttf?inline'
import body_cyrillic_ext from './fonts/ysabeau-office-cyrillic-ext-400-normal.ttf?inline'
import bodyStrong_latin from './fonts/ysabeau-office-latin-600-normal.ttf?inline'
import bodyStrong_latin_ext from './fonts/ysabeau-office-latin-ext-600-normal.ttf?inline'
import bodyStrong_cyrillic from './fonts/ysabeau-office-cyrillic-600-normal.ttf?inline'
import bodyStrong_cyrillic_ext from './fonts/ysabeau-office-cyrillic-ext-600-normal.ttf?inline'

export type PrintKitFontFace = 'display' | 'body' | 'bodyStrong'

const DATA_URIS: Readonly<
  Record<PrintKitFontFace, Readonly<Record<FontSubset, string>>>
> = {
  display: {
    latin: display_latin,
    'latin-ext': display_latin_ext,
    cyrillic: display_cyrillic,
    'cyrillic-ext': display_cyrillic_ext,
  },
  body: {
    latin: body_latin,
    'latin-ext': body_latin_ext,
    cyrillic: body_cyrillic,
    'cyrillic-ext': body_cyrillic_ext,
  },
  bodyStrong: {
    latin: bodyStrong_latin,
    'latin-ext': bodyStrong_latin_ext,
    cyrillic: bodyStrong_cyrillic,
    'cyrillic-ext': bodyStrong_cyrillic_ext,
  },
}

const decoded = new Map<string, Buffer>()

/** The woff2 bytes of one subset of one face. */
export function printKitFontBytes(face: PrintKitFontFace, subset: FontSubset): Buffer {
  const key = `${face}:${subset}`
  const cached = decoded.get(key)
  if (cached) return cached
  const uri = DATA_URIS[face][subset]
  const bytes = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64')
  decoded.set(key, bytes)
  return bytes
}

export const PRINT_KIT_FONT_FACES: readonly PrintKitFontFace[] = [
  'display',
  'body',
  'bodyStrong',
]
