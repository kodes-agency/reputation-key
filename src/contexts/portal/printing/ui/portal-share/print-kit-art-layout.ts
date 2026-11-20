// The one thing the preview's faces share that no measure holds: how they ask the
// browser for the figures the file sets.

/**
 * Lining figures for what the file sets in Cormorant, whose default figures are
 * old-style. It is the OpenType feature the lining value of font-variant-numeric
 * switches on, written as a feature setting on purpose: Tailwind's scanner reads
 * every token under `src/`, and the CSS keyword spelt out here would make it emit
 * a utility into the first-paint stylesheet (18 B gzip, against a closure with
 * 200 B to spare).
 */
export const LINING_FIGURES = { fontFeatureSettings: '"lnum" 1' } as const
