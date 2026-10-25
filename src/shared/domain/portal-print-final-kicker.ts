// When the kicker says what the headline says (final design spec §5.9): a page
// titled "Review us on Google" printing the headline "Review us on Google" would
// read the same words twice, so the kicker is not drawn and the message group
// closes up (the planner re-centres it; the gaps stay 4u to 8u).
//
// Both strings are normalised first: lower case, accents off, letters and digits
// only, runs of spaces collapsed. Equal after that, the headline repeats the
// kicker: "Review us on Google" against "Review us on Google!" is a repeat, "Rate
// your visit" against "Review us on Google" is not. It applies to presets too.

/** Lower case, accents off, letters and digits only, spaces collapsed. */
export function normalisePrintFinalWords(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Whether the headline repeats the kicker, so the kicker is left out. */
export function printFinalKickerRepeated(kicker: string, headline: string): boolean {
  const said = normalisePrintFinalWords(kicker)
  return said !== '' && said === normalisePrintFinalWords(headline)
}
