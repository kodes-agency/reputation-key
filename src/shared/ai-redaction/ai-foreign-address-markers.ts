// Street addresses written the way other languages write them, a few streets
// that are their own type, and the address after a label.
//
// - A street-type word before the name, with the house number first or last:
//   `12 rue de la Paix`, `Calle Mayor 5`, `Via Roma 10`, `Rua das Flores 23`,
//   `Strada Victoriei 12`.
// - A street whose type is the end of its word: `Hauptstraße 12`,
//   `Pestalozzistrasse 3`, `Hoofdstraat 12`, `Kungsgatan 12`, `Storgata 12`,
//   `Nørregade 12`; or a word of its own after the name: `Atatürk Caddesi No: 5`,
//   `Andrassy ut 12`.
// - A street that is its own type: `50 Broadway`.
// - The words after `Address:` (and its translations) up to the end of the
//   clause, when they hold a digit: `Address: Karlova 12.`, `Address: Vasilissis
//   Sofias 12`. A capitalised name and a number alone cannot be told from `Room
//   12`, but after a label they are the address. The value is read word by word
//   (capitalised words, particles, numbers, `No.`, `house`) and ends at the
//   first plain word or full stop, so the label's prose is not taken with it.
//
// Not detected: a foreign street with no type word and no label (`Karlova 12`
// alone), and a street word of a language not listed here.

import { leadOf } from './ai-address-name-rules'
import {
  FOREIGN_LOWER_CASE_TYPE_WORDS,
  FOREIGN_NAME_PARTICLE_WORDS,
  LABEL_QUALIFIER_WORDS,
  LABEL_STOP_WORDS,
} from './ai-address-words'
import {
  endsClause,
  followedByQuantity,
  tokensOf,
  withPostalTail,
  type AddressMarkerSpan,
  type Token,
} from './ai-address-spans'

const MAX_FOREIGN_NAME_WORDS = 4
const MAX_LABEL_VALUE_TOKENS = 10
const MAX_LABEL_VALUE_SCALARS = 100

const PARTICLES: ReadonlySet<string> = new Set(FOREIGN_NAME_PARTICLE_WORDS)
const LOWER_CASE_TYPES: ReadonlySet<string> = new Set(FOREIGN_LOWER_CASE_TYPE_WORDS)
const QUALIFIERS: ReadonlySet<string> = new Set(LABEL_QUALIFIER_WORDS)
const STOP_WORDS: ReadonlySet<string> = new Set(LABEL_STOP_WORDS)

/*
 * Candidate repetitions are bounded ({1,5}, {1,2}) and every repeated unit ends in
 * a mandatory blank or starts after a letter-class lookbehind; the input is
 * capped at 65,536 scalars before any pattern runs. The security rule cannot
 * model that.
 */
/* eslint-disable security/detect-unsafe-regex */
/** House number first: `12 rue de la Paix`, `5 Calle Mayor`. */
const PREFIX_TYPE_NUMBER_FIRST_RE =
  /(?<![\p{L}\p{M}\p{N}.,:$€£])(\d{1,5}[A-Ea-e]?)(,?[ \t]+)(rue|calle|carrer|rua|strada|piazza|paseo|camino|corso|chemin|avenida|viale|quai|allée|allee|ulica|ul|plac|via)(?![\p{L}\p{M}])\.?((?:[ \t]+[\p{L}\p{M}'’-]+\.?){1,5})/giu
/** House number last: `Calle Mayor 5`, `Rua das Flores 23`. */
const PREFIX_TYPE_NUMBER_LAST_RE =
  /(?<![\p{L}\p{M}])(Calle|Carrer|Via|Viale|Rua|Strada|Piazza|Avenida|Paseo|Camino|Corso|Bulevardul|Calea|Aleea|Ulica|Ul|Plac|Rue|Chemin|Allée|Rynek)(?![\p{L}\p{M}])\.?((?:[ \t]+[\p{L}\p{M}'’-]+\.?){1,5})[ \t]*[,;]?[ \t]*(?:(?:No|Nr|N°|Nº|№|#)\.?[ \t]*:?[ \t]*)?(\d{1,5}[A-Ea-e]?)(?![\p{L}\p{N}/:%]|\.\d)/gu
/** The type is the end of the word: `Hauptstraße 12`, `Kungsgatan 12`. */
const SUFFIX_TYPE_RE =
  /(?<![\p{L}\p{M}])(\p{Lu}[\p{L}\p{M}'’-]+(?:straße|strasse|gasse|platz|allee|straat|gatan|gata|vägen|vej|gade|gaden|str\.))[ \t]*,?[ \t]*(?:(?:No|Nr|N°|Nº|№|#)\.?[ \t]*:?[ \t]*)?(\d{1,5}[A-Ea-e]?)(?![\p{L}\p{N}/:%]|\.\d)/giu
/** The type is a word after the name: `Atatürk Caddesi No: 5`, `Andrassy ut 12`. */
const SEPARATE_SUFFIX_RE =
  /(?<![\p{L}\p{M}])((?:\p{Lu}[\p{L}\p{M}'’-]*[ \t]+){1,2})(Caddesi|Cad\.|Sokak|Sk\.|ut|út|utca|ulice|cesta|gate|veien|vei|gaten)(?![\p{L}\p{M}])[ \t]*,?[ \t]*(?:(?:No|Nr|N°|Nº|№|#)\.?[ \t]*:?[ \t]*)?(\d{1,5}[A-Ea-e]?)(?![\p{L}\p{N}/:%]|\.\d)/gu
/** A street that is its own type: `50 Broadway`. */
const OWN_TYPE_RE =
  /(?<![\p{L}\p{M}\p{N}.,:$€£])(\d{1,5}[A-Ea-e]?)[ \t]+(Broadway|Esplanade|Promenade|Embankment)(?![\p{L}\p{M}])/gu
/** A label for an address, and the colon or equals sign after it. */
const ADDRESS_LABEL_RE =
  /(?<![\p{L}\p{M}])(?:addresses|address|addr|adresa|adresse|adres|adress|адрес|адреса|indirizzo|dirección|direccion|endereço|endereco|morada|cím)[ \t]*[:=][ \t]*/giu
/* eslint-enable security/detect-unsafe-regex */

const isCapitalised = (word: string): boolean => /^\p{Lu}/u.test(word)

/** A word with the full stop that closed it taken off, and whether it closed. */
function withoutStop(word: string): readonly [string, boolean] {
  return /[.;!?]$/u.test(word) ? [word.slice(0, -1), true] : [word, false]
}

/**
 * The leading words of a street's name in another language: capitalised words,
 * and particles (`de la`, `das`, `von`), after which one word may be lower case
 * (`rue de rivoli`). Ends at a full stop; never ends on a particle.
 */
function foreignNameTokens(run: string, base: number): readonly Token[] {
  const kept: Token[] = []
  let afterParticle = false
  for (const token of tokensOf(run, base)) {
    const [word, stops] = withoutStop(token.word)
    const particle = PARTICLES.has(word)
    if (kept.length >= MAX_FOREIGN_NAME_WORDS) break
    if (!isCapitalised(word) && !particle && !afterParticle) break
    kept.push(token)
    afterParticle = particle
    if (stops) break
  }
  while (kept.length > 0 && PARTICLES.has(withoutStop(kept.at(-1)?.word ?? '')[0])) {
    kept.pop()
  }
  return kept
}

function tokenEnd(token: Token): number {
  return token.end - (withoutStop(token.word)[1] ? 1 : 0)
}

function typeAccepted(rawType: string): boolean {
  return LOWER_CASE_TYPES.has(rawType.toLowerCase()) || isCapitalised(rawType)
}

function findPrefixTypeNumberFirst(text: string): readonly AddressMarkerSpan[] {
  const spans: AddressMarkerSpan[] = []
  for (const match of text.matchAll(PREFIX_TYPE_NUMBER_FIRST_RE)) {
    const [whole, , , rawType = '', run = ''] = match
    if (!typeAccepted(rawType)) continue
    const name = foreignNameTokens(run, match.index + whole.length - run.length)
    const last = name.at(-1)
    if (last === undefined) continue
    spans.push(withPostalTail(text, match.index, tokenEnd(last)))
  }
  return spans
}

/** Whether every word is a capitalised name word or a particle and the last is a name word. */
function isProperRun(words: readonly string[]): boolean {
  const last = words.at(-1) ?? ''
  return (
    isCapitalised(last) &&
    words.every((word) => isCapitalised(word) || PARTICLES.has(word)) &&
    words.length <= MAX_FOREIGN_NAME_WORDS
  )
}

function findPrefixTypeNumberLast(text: string): readonly AddressMarkerSpan[] {
  const spans: AddressMarkerSpan[] = []
  for (const match of text.matchAll(PREFIX_TYPE_NUMBER_LAST_RE)) {
    const [whole, , run = ''] = match
    const end = match.index + whole.length
    if (!isProperRun(run.trim().split(/[ \t]+/u)) || followedByQuantity(text, end)) {
      continue
    }
    spans.push(withPostalTail(text, match.index, end))
  }
  return spans
}

function findSuffixTypes(text: string): readonly AddressMarkerSpan[] {
  const spans: AddressMarkerSpan[] = []
  for (const match of text.matchAll(SUFFIX_TYPE_RE)) {
    const end = match.index + match[0].length
    if (!isCapitalised(match[1] ?? '') || followedByQuantity(text, end)) continue
    spans.push(withPostalTail(text, match.index, end))
  }
  for (const match of text.matchAll(SEPARATE_SUFFIX_RE)) {
    const end = match.index + match[0].length
    if (followedByQuantity(text, end)) continue
    spans.push(withPostalTail(text, match.index, end))
  }
  return spans
}

function findOwnTypes(text: string): readonly AddressMarkerSpan[] {
  const spans: AddressMarkerSpan[] = []
  for (const match of text.matchAll(OWN_TYPE_RE)) {
    const end = match.index + match[0].length
    if (endsClause(text, end) || leadOf(text, match.index).address) {
      spans.push(withPostalTail(text, match.index, end))
    }
  }
  return spans
}

type LabelToken = Readonly<{ token: Token; kind: 'digits' | 'word' | 'stop' }>

/** How one word of a label's value reads: a number, a name word or the end of the value. */
function classifyLabelWord(word: string): 'digits' | 'word' | 'stop' {
  const bare = word.replace(/^[(#]|[),]$/gu, '')
  const lower = bare.toLowerCase().replace(/[.:]$/u, '')
  if (/^\d[\p{L}\p{N}/-]*$/u.test(bare)) return 'digits'
  if (QUALIFIERS.has(lower)) return 'word'
  if (STOP_WORDS.has(lower) && isCapitalised(bare)) return 'stop'
  if (isCapitalised(bare) || PARTICLES.has(lower) || /^[,;–-]$/u.test(bare)) {
    return 'word'
  }
  return 'stop'
}

/** The value after a label, as the words that read as an address, until one does not. */
function labelValue(text: string, start: number): readonly LabelToken[] {
  const run = text.slice(start, start + MAX_LABEL_VALUE_SCALARS)
  const kept: LabelToken[] = []
  for (const token of tokensOf(run, start).slice(0, MAX_LABEL_VALUE_TOKENS)) {
    const [word, stops] = withoutStop(token.word)
    const kind = classifyLabelWord(word)
    if (kind === 'stop') break
    kept.push({ token, kind })
    if (stops && !QUALIFIERS.has(word.replace(/^[(#]/u, '').toLowerCase())) break
  }
  return kept
}

function findLabelledAddresses(text: string): readonly AddressMarkerSpan[] {
  const spans: AddressMarkerSpan[] = []
  for (const label of text.matchAll(ADDRESS_LABEL_RE)) {
    const start = label.index + label[0].length
    const value = labelValue(text, start)
    const first = value[0]
    const last = value.at(-1)
    if (first === undefined || last === undefined) continue
    const hasDigits = value.some((entry) => entry.kind === 'digits')
    const hasWord = value.some((entry) => /\p{L}{2}/u.test(entry.token.word))
    if (hasDigits && hasWord) {
      spans.push({ start: first.token.start, end: tokenEnd(last.token) })
    }
  }
  return spans
}

const FOREIGN_FINDERS: ReadonlyArray<(text: string) => readonly AddressMarkerSpan[]> = [
  findPrefixTypeNumberFirst,
  findPrefixTypeNumberLast,
  findSuffixTypes,
  findOwnTypes,
  findLabelledAddresses,
]

/** Every foreign-layout, own-type and labelled address of `text`. */
export function findForeignAddressMarkers(text: string): readonly AddressMarkerSpan[] {
  return FOREIGN_FINDERS.flatMap((find) => find(text))
}

/** What the detector profile digest records about the foreign address markers. */
export const FOREIGN_ADDRESS_PROFILE = Object.freeze({
  patterns: Object.freeze(
    (
      [
        ['address_prefix_type_number_first', PREFIX_TYPE_NUMBER_FIRST_RE],
        ['address_prefix_type_number_last', PREFIX_TYPE_NUMBER_LAST_RE],
        ['address_suffix_type', SUFFIX_TYPE_RE],
        ['address_separate_suffix', SEPARATE_SUFFIX_RE],
        ['address_own_type', OWN_TYPE_RE],
        ['address_label', ADDRESS_LABEL_RE],
      ] as const
    ).map(([id, expression]) =>
      Object.freeze({ id, source: expression.source, flags: expression.flags }),
    ),
  ),
  wordLists: Object.freeze({
    particles: FOREIGN_NAME_PARTICLE_WORDS,
    lowerCaseTypes: FOREIGN_LOWER_CASE_TYPE_WORDS,
    labelQualifiers: LABEL_QUALIFIER_WORDS,
    labelStopWords: LABEL_STOP_WORDS,
  }),
  limits: Object.freeze({
    maxForeignNameWords: MAX_FOREIGN_NAME_WORDS,
    maxLabelValueTokens: MAX_LABEL_VALUE_TOKENS,
    maxLabelValueScalars: MAX_LABEL_VALUE_SCALARS,
  }),
})
