// Street-address markers of structured-marker-detectors-v1.
//
// An address is a house number, the street's name and a street-type word
// (`25 Main Street`). The first version of this detector took a number, up to
// eight arbitrary words and a word like `place`, `way` or `drive`, so it also
// took `2 weeks here and it was a wonderful place` and `a 10 minute drive`:
// whole clauses of ordinary prose became [ADDRESS], and a short review that
// was mostly such a clause was refused outright. Two layouts count now.
//
// NAME FIRST (`25 Main Street`, `7 oak lane`, `12 de la Rosa Street`): the
// house number, one to six name words, a street-type word, then an optional
// postal code. The regex finds the shape loosely and any case; `isNameFirst`
// decides, because case and the words themselves are the evidence:
//
// - Counted units (`2 Minutes Drive`, `3 nights ... place`) are never a name.
// - A run of capitalised words, ordinals and the lower-case connectors of a
//   proper name (`de la`, `van der`) is a named street. With a street-type word
//   that is hardly ever anything else (`street`, `road`, `avenue`, `boulevard`
//   and their abbreviations) nothing more is asked: `12 Golf Course Road`.
// - The ambiguous street-type words (`lane`, `drive`, `way`, `court`, `place`
//   and their abbreviations) are also everyday words, so a name before one of
//   them must not read as a filler, a pronoun or praise: `10 for this place`,
//   `5 Stars Great Place` and `10/10 GREAT PLACE` stay prose, `5 Park Lane` and
//   `7 oak lane` are addresses.
// - Typed in lower case (or any other mix), the name is at most four words and
//   none of them reads as a filler: `12 martin luther king jr street`.
//
// STREET FIRST (`100 Boulevard Saint-Germain`, `8 Place de la Concorde`): the
// house number, a capitalised avenue, boulevard or place, and the capitalised
// words of its name. Only the place word is also an everyday word, so its name
// goes through the same filler and praise check (`10 PLACE TO STAY`).
//
// Both end in an optional postal code. A match that grows past the 256-scalar
// candidate cap still blocks the whole text (`addCandidate`), as before.
//
// Not detected, before or after: a street written after its number
// (`Main Street 25`), street words in other languages (`ул. Витоша 25`, `rue`),
// and a street-first layout typed in lower case (`100 boulevard haussmann`).

/**
 * Things a guest counts or measures. A number followed by one of them is a
 * quantity, whatever follows: `2 Minutes Drive`, `3 nights near the street`.
 * Part of the profile digest, so editing it moves the digest.
 */
const COUNTED_UNIT_WORDS: readonly string[] = Object.freeze([
  'bed',
  'bedroom',
  'bedrooms',
  'beds',
  'buck',
  'bucks',
  'cent',
  'cents',
  'cm',
  'day',
  'days',
  'dollar',
  'dollars',
  'euro',
  'euros',
  'gb',
  'guest',
  'guests',
  'hour',
  'hours',
  'hr',
  'hrs',
  'kg',
  'km',
  'leva',
  'lev',
  'mb',
  'mbps',
  'meter',
  'meters',
  'metre',
  'metres',
  'mile',
  'miles',
  'min',
  'mins',
  'minute',
  'minutes',
  'month',
  'months',
  'night',
  'nights',
  'people',
  'percent',
  'person',
  'pound',
  'pounds',
  'room',
  'rooms',
  'sqm',
  'star',
  'stars',
  'step',
  'steps',
  'time',
  'times',
  'week',
  'weeks',
  'year',
  'years',
])

/**
 * Articles, prepositions, directions and pronouns: the glue of a sentence that
 * puts a number next to a street word (`10 steps from street`, `10 for this
 * place`). Unlike the counted units they can be part of a street's name
 * (`12 Golf Course Road`, `Lane Cove Road`), so they only rule out a name that
 * is not written as one.
 */
const FILLER_WORDS: readonly string[] = Object.freeze([
  'a',
  'about',
  'across',
  'after',
  'all',
  'along',
  'an',
  'and',
  'any',
  'are',
  'around',
  'as',
  'at',
  'away',
  'be',
  'been',
  'before',
  'block',
  'blocks',
  'but',
  'by',
  'course',
  'courses',
  'down',
  'each',
  'every',
  'floor',
  'floors',
  'for',
  'from',
  'he',
  'her',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'lane',
  'lanes',
  'more',
  'my',
  'near',
  'no',
  'not',
  'of',
  'off',
  'on',
  'only',
  'or',
  'other',
  'our',
  'out',
  'over',
  'past',
  'per',
  'same',
  'she',
  'so',
  'than',
  'that',
  'the',
  'their',
  'then',
  'these',
  'they',
  'this',
  'those',
  'to',
  'too',
  'under',
  'up',
  'very',
  'was',
  'way',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'with',
  'you',
  'your',
])

/**
 * Praise and complaint, applied to the ambiguous street-type words only:
 * `10 great place`, `9 lovely place`. A real street named `Great` or `Good`
 * before `lane` or `court` is rare enough to give up.
 */
const EVALUATIVE_WORDS: readonly string[] = Object.freeze([
  'amazing',
  'awesome',
  'awful',
  'bad',
  'beautiful',
  'best',
  'clean',
  'central',
  'charming',
  'cheap',
  'comfortable',
  'cosy',
  'cozy',
  'decent',
  'dirty',
  'enjoyed',
  'excellent',
  'expensive',
  'fabulous',
  'fantastic',
  'friendly',
  'good',
  'great',
  'helpful',
  'horrible',
  'kind',
  'love',
  'loved',
  'lovely',
  'modern',
  'nice',
  'noisy',
  'perfect',
  'polite',
  'quiet',
  'recommend',
  'recommended',
  'relaxing',
  'spacious',
  'stay',
  'stayed',
  'super',
  'superb',
  'terrible',
  'visit',
  'visited',
  'wonderful',
  'worst',
  'worth',
])

/** Lower-case words that sit inside a proper street name. */
const NAME_CONNECTOR_WORDS: readonly string[] = Object.freeze([
  'al',
  'da',
  'de',
  'del',
  'della',
  'den',
  'der',
  'des',
  'di',
  'du',
  'el',
  'het',
  'la',
  'le',
  'les',
  'of',
  'the',
  'van',
  'von',
])

/** Street-type words that are also everyday words. */
const AMBIGUOUS_STREET_TYPES: readonly string[] = Object.freeze([
  'lane',
  'ln',
  'drive',
  'dr',
  'way',
  'court',
  'ct',
  'place',
  'pl',
])

const MAX_LOWER_CASE_NAME_WORDS = 4

const COUNTED_UNITS = new Set<string>(COUNTED_UNIT_WORDS)
const FILLERS = new Set<string>(FILLER_WORDS)
const EVALUATIVES = new Set<string>(EVALUATIVE_WORDS)
const CONNECTORS = new Set<string>(NAME_CONNECTOR_WORDS)
const AMBIGUOUS_TYPES = new Set<string>(AMBIGUOUS_STREET_TYPES)

/*
 * Candidate repetitions are bounded ({1,6}, {1,4}, {0,3}) and every repeated unit ends
 * in a mandatory blank or starts with a letter case that no connector shares, so
 * none can overlap the next; the input is capped at 65,536 scalars before any
 * pattern runs. The security rule cannot model that.
 */
/* eslint-disable security/detect-unsafe-regex */
/**
 * Name first: a house number, one to six words (or ordinals like `5th`; a
 * word may end in a full stop, `isNameFirst` refuses one that ends a sentence),
 * any street-type word. Case-insensitive; the shape of the words is judged in
 * code, so this only finds the candidates.
 */
const NAME_FIRST_RE =
  /\b\d{1,8}[A-Za-z]?[ \t]+((?:(?:\d{1,3}(?:st|nd|rd|th)|[\p{L}\p{M}][\p{L}\p{M}'’-]*\.?)[ \t]+){1,6})(street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl)\b(?:[, \t]+\d{4,10}(?:-\d{3,4})?)?/giu
/**
 * Street first: a house number, a capitalised avenue, boulevard or place (title
 * case or all capitals; each letter of the street-type word spells out both its
 * cases because the name words after it are case-sensitive), then one to four
 * capitalised name words with lower-case connectors between them.
 */
const STREET_FIRST_RE =
  /\b\d{1,8}[A-Za-z]?[ \t]+([Aa][Vv][Ee](?:[Nn][Uu][Ee])?|[Bb](?:[Oo][Uu][Ll][Ee][Vv][Aa][Rr][Dd]|[Ll][Vv][Dd])|[Pp][Ll](?:[Aa][Cc][Ee])?)\b\.?((?:[ \t]+(?:(?:al|da|de|del|della|den|der|des|di|du|el|het|la|le|les|of|the|van|von)[ \t]+){0,3}(?:\p{Lu}[\p{L}\p{M}'’-]*|\d{1,3}(?:st|nd|rd|th|ST|ND|RD|TH))){1,4})(?:[, \t]+\d{4,10}(?:-\d{3,4})?)?/gu
/* eslint-enable security/detect-unsafe-regex */

/** A capitalised word, an abbreviation like `St.` or `Jr.`, or an ordinal. */
const NAME_WORD_RE =
  /^(?:\p{Lu}[\p{L}\p{M}'’-]*|\p{Lu}[\p{L}\p{M}]{0,2}\.|\d{1,3}(?:st|nd|rd|th|ST|ND|RD|TH))$/u

export type AddressMarkerSpan = Readonly<{ start: number; end: number }>

function wordsOf(run: string): readonly string[] {
  return run.trim().split(/[ \t]+/u)
}

function containsWordOf(words: readonly string[], list: ReadonlySet<string>): boolean {
  return words.some((word) => list.has(word.toLowerCase()))
}

/** A word that ends in a full stop and is not an abbreviation ends a sentence. */
function endsSentence(word: string): boolean {
  return word.endsWith('.') && !NAME_WORD_RE.test(word)
}

/**
 * Capitalised words, with lower-case connectors between or before them, that
 * end on a capitalised word: how a proper street name is written.
 */
function isNamedRun(words: readonly string[]): boolean {
  const last = words.at(-1)
  return (
    last !== undefined &&
    NAME_WORD_RE.test(last) &&
    words.every((word) => NAME_WORD_RE.test(word) || CONNECTORS.has(word))
  )
}

function isNameFirst(run: string, streetType: string): boolean {
  const words = wordsOf(run)
  if (words.some(endsSentence) || containsWordOf(words, COUNTED_UNITS)) return false
  const ambiguous = AMBIGUOUS_TYPES.has(streetType.toLowerCase())
  if (
    ambiguous &&
    (containsWordOf(words, FILLERS) || containsWordOf(words, EVALUATIVES))
  ) {
    return false
  }
  if (isNamedRun(words)) return true
  return words.length <= MAX_LOWER_CASE_NAME_WORDS && !containsWordOf(words, FILLERS)
}

function isStreetFirst(streetType: string, name: string): boolean {
  if (!AMBIGUOUS_TYPES.has(streetType.toLowerCase())) return true
  const words = wordsOf(name)
  return !containsWordOf(words, FILLERS) && !containsWordOf(words, EVALUATIVES)
}

/** Every address-shaped span of `text`, in order of appearance. */
export function findAddressMarkers(text: string): readonly AddressMarkerSpan[] {
  const spans: AddressMarkerSpan[] = []
  for (const match of text.matchAll(NAME_FIRST_RE)) {
    if (!isNameFirst(match[1] ?? '', match[2] ?? '')) continue
    spans.push({ start: match.index, end: match.index + match[0].length })
  }
  for (const match of text.matchAll(STREET_FIRST_RE)) {
    if (!isStreetFirst(match[1] ?? '', match[2] ?? '')) continue
    spans.push({ start: match.index, end: match.index + match[0].length })
  }
  return spans
}

/** What the detector profile digest records about the address markers. */
export const ADDRESS_MARKER_PROFILE = Object.freeze({
  patterns: Object.freeze([
    Object.freeze({
      id: 'address_name_first',
      source: NAME_FIRST_RE.source,
      flags: NAME_FIRST_RE.flags,
    }),
    Object.freeze({
      id: 'address_street_first',
      source: STREET_FIRST_RE.source,
      flags: STREET_FIRST_RE.flags,
    }),
  ]),
  wordLists: Object.freeze({
    countedUnits: COUNTED_UNIT_WORDS,
    fillers: FILLER_WORDS,
    evaluatives: EVALUATIVE_WORDS,
    nameConnectors: NAME_CONNECTOR_WORDS,
    ambiguousStreetTypes: AMBIGUOUS_STREET_TYPES,
  }),
  maxLowerCaseNameWords: MAX_LOWER_CASE_NAME_WORDS,
})
