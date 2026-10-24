// What shape the address of a printed code has (ADR 0069): the long address, or the
// short print address (the print host and a print code).
//
// A module of its own, with no imports, because the Share tab asks it too (which
// NFC hint to show) and the first-load bundle has almost no room: importing the
// code tile's rule for one regex would pull its `Result` into a chunk of its own.

/**
 * What the address is: a long address (the whole token and the access-artifact
 * marker: 147 characters on the fixture host, 159 on the beta) or a short print
 * address (the print host and a print code). It decides which way a refusal reads.
 */
export type PrintAddressShape = 'long' | 'short'

/** A print code after `/p/`: 20 characters of Crockford base32, in either case, and nothing after them. */
const SHORT_ADDRESS_PATH = /^\/p\/[0-9A-HJKMNP-TV-Z]{20}$/iu

/**
 * The shape of the address a code encodes. A short print address is a host and
 * `/p/` with a 20-character print code and no query; anything else (the whole
 * token and its access-artifact marker) is long. It only decides which way a
 * refusal reads, so a string that is not a URL counts as long.
 */
export function printAddressShape(address: string): PrintAddressShape {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return 'long'
  }
  return url.search === '' && url.hash === '' && SHORT_ADDRESS_PATH.test(url.pathname)
    ? 'short'
    : 'long'
}
