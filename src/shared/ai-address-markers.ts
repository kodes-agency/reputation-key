// Street-address markers of structured-marker-detectors-v1.
//
// An address is a house number, the street's name and a street-type word
// (`25 Main Street`). The first version of this detector took a number, up to
// eight arbitrary words and a word like `place`, `way` or `drive`, so it also
// took `2 weeks here and it was a wonderful place` and `a 10 minute drive`:
// whole clauses of ordinary prose became [ADDRESS], and a short review that
// was mostly such a clause was refused outright. Two shapes now count:
//
// 1. A NAMED street: the house number, one to four name words that each start
//    with a capital (or are an ordinal like `5th`), then any street-type word.
//    Case is the evidence here, so the name words are matched case-sensitively.
//    This is the shape an address has when someone copies or types it with care,
//    and it is the only shape that admits the ambiguous street-type words
//    (`way`, `place`, `drive`, `court`, `lane`, `dr`, `ct`, `pl`).
// 2. An INFORMAL street, for the guest who typed `25 main street` in lower case:
//    the house number, one or two words, then a street-type word that is hardly
//    ever anything else (`street`, `road`, `avenue`, `boulevard` and their
//    abbreviations). The words in between must not read as a quantity or a
//    preposition (`5 minute road trip`, `10 steps from street`).
//
// Both end in an optional postal code. A match that grows past the 256-scalar
// candidate cap still blocks the whole text (`addCandidate`), as before.
//
// A street written the other way round (`Main Street 25`) and street words in
// other languages were never covered and are still not.

/**
 * Words that make `<number> <word> <street word>` a quantity or a movement,
 * not an address: units of time, distance, price and capacity, the things a
 * guest counts, and the prepositions of a walking direction. Part of the
 * profile digest, so editing it moves the digest.
 */
const INFORMAL_STREET_EXCLUDED_WORDS: readonly string[] = Object.freeze([
  'a',
  'across',
  'along',
  'an',
  'and',
  'around',
  'at',
  'away',
  'bed',
  'bedroom',
  'bedrooms',
  'beds',
  'block',
  'blocks',
  'by',
  'cent',
  'cents',
  'course',
  'courses',
  'day',
  'days',
  'down',
  'euro',
  'euros',
  'floor',
  'floors',
  'from',
  'guest',
  'guests',
  'hour',
  'hours',
  'hr',
  'hrs',
  'in',
  'km',
  'lane',
  'lanes',
  'leva',
  'mile',
  'miles',
  'min',
  'mins',
  'minute',
  'minutes',
  'month',
  'months',
  'near',
  'night',
  'nights',
  'of',
  'off',
  'on',
  'out',
  'people',
  'person',
  'past',
  'percent',
  'room',
  'rooms',
  'star',
  'stars',
  'step',
  'steps',
  'the',
  'time',
  'times',
  'to',
  'up',
  'way',
  'week',
  'weeks',
  'year',
  'years',
])

const EXCLUDED_WORDS = new Set<string>(INFORMAL_STREET_EXCLUDED_WORDS)

/*
 * Candidate repetitions are bounded ({1,4}, {1,2}) and every repeated unit ends
 * in a mandatory blank, so none can overlap the next; the input is capped at
 * 65,536 scalars before any pattern runs. The security rule cannot model that.
 */
/* eslint-disable security/detect-unsafe-regex */
/**
 * A house number, one to four capitalised name words, any street-type word:
 * street st road rd avenue ave boulevard blvd lane ln drive dr way court ct
 * place pl. Only the name words are case-sensitive, so each letter of the
 * street-type word spells out both its cases.
 */
const NAMED_STREET_RE =
  /\b\d{1,8}[A-Za-z]?[ \t]+(?:(?:\p{Lu}[\p{L}\p{M}'’-]*|\p{Lu}[\p{L}\p{M}]{0,2}\.|\d{1,3}(?:st|nd|rd|th|ST|ND|RD|TH))[ \t]+){1,4}(?:[Ss][Tt](?:[Rr][Ee][Ee][Tt])?|[Rr](?:[Oo][Aa])?[Dd]|[Aa][Vv][Ee](?:[Nn][Uu][Ee])?|[Bb](?:[Oo][Uu][Ll][Ee][Vv][Aa][Rr][Dd]|[Ll][Vv][Dd])|[Ll](?:[Aa][Nn][Ee]|[Nn])|[Dd][Rr](?:[Ii][Vv][Ee])?|[Ww][Aa][Yy]|[Cc](?:[Oo][Uu][Rr])?[Tt]|[Pp][Ll](?:[Aa][Cc][Ee])?)\b(?:[, \t]+\d{4,10}(?:-\d{3,4})?)?/gu
/** A house number, one or two words, an unambiguous street-type word; any case. */
const INFORMAL_STREET_RE =
  /\b\d{1,8}[A-Za-z]?[ \t]+((?:[\p{L}\p{M}][\p{L}\p{M}'’-]*[ \t]+){1,2})(?:street|st|road|rd|avenue|ave|boulevard|blvd)\b(?:[, \t]+\d{4,10}(?:-\d{3,4})?)?/giu
/* eslint-enable security/detect-unsafe-regex */

export type AddressMarkerSpan = Readonly<{ start: number; end: number }>

function readsAsQuantityOrDirection(words: string): boolean {
  return words
    .trim()
    .split(/[ \t]+/u)
    .some((word) => EXCLUDED_WORDS.has(word.toLowerCase()))
}

/** Every address-shaped span of `text`, in order of appearance. */
export function findAddressMarkers(text: string): readonly AddressMarkerSpan[] {
  const spans: AddressMarkerSpan[] = []
  for (const match of text.matchAll(NAMED_STREET_RE)) {
    spans.push({ start: match.index, end: match.index + match[0].length })
  }
  for (const match of text.matchAll(INFORMAL_STREET_RE)) {
    if (readsAsQuantityOrDirection(match[1] ?? '')) continue
    spans.push({ start: match.index, end: match.index + match[0].length })
  }
  return spans
}

/** What the detector profile digest records about the address markers. */
export const ADDRESS_MARKER_PROFILE = Object.freeze({
  patterns: Object.freeze([
    Object.freeze({
      id: 'address_informal_street',
      source: INFORMAL_STREET_RE.source,
      flags: INFORMAL_STREET_RE.flags,
    }),
    Object.freeze({
      id: 'address_named_street',
      source: NAMED_STREET_RE.source,
      flags: NAMED_STREET_RE.flags,
    }),
  ]),
  informalStreetExcludedWords: INFORMAL_STREET_EXCLUDED_WORDS,
})
