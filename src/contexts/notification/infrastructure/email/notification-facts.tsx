// How a notification's fact line is presented in email, in BOTH channels.
//
// `renderNotification().summary` is already the canonical fact list —
// "Riverside Hotel · 2-star review · waiting 3h" — assembled in the domain from
// governed payload fields only (ADR 0046 r.8: property name, numeric rating,
// ages, counts; never review text, reviewer identity or media). This module
// only decides how those facts LOOK; it never adds a fact and never reaches for
// the payload, which is why no Google-sourced string can enter here.
//
// The star rating is the one fact that needs a presentation decision. Glyphs
// alone fail WCAG 1.4.1 (information conveyed by shape alone) and read as
// "black star black star white star…" in a screen reader, so the glyph run is
// `aria-hidden` decoration sitting next to the domain's own wording. The
// plain-text twin drops the glyphs entirely and says `2/5`.

import { Text } from '@react-email/components'
import { EMAIL_PALETTE } from '#/shared/email'

const { light } = EMAIL_PALETTE

/** "2-star review" → the leading rating, when the fact carries one. */
const RATING_FACT = /^([1-5])-star\b/
/** Same rating token, anywhere in a line, for the plain-text rewrite. */
const RATING_TOKEN = /\b([1-5])-star\b/g

/** Split a domain summary back into its individual facts. */
export const splitFacts = (summary: string): ReadonlyArray<string> =>
  summary
    .split('·')
    .map((fact) => fact.trim())
    .filter((fact) => fact !== '')

/** "★★☆☆☆" for 2. Decorative only — always paired with the wording. */
const starGlyphs = (rating: number): string => '★'.repeat(rating) + '☆'.repeat(5 - rating)

/**
 * Plain-text form of a fact line: the rating becomes `2/5`, because glyphs and
 * the hyphenated "2-star" both degrade badly in a text-only client.
 */
export const toPlainFacts = (summary: string): string =>
  summary.replace(RATING_TOKEN, '$1/5')

/**
 * The compact metadata strip under a headline: property, rating, waiting time.
 *
 * Renders nothing at all when the notification carried no metadata — an empty
 * bullet rule is worse than no rule.
 */
export const FactsStrip = ({ summary }: Readonly<{ summary: string }>) => {
  const facts = splitFacts(summary)
  if (facts.length === 0) return null
  return (
    <Text
      className="rk-muted"
      style={{
        color: light.textSecondary,
        fontSize: '13px',
        lineHeight: 1.5,
        margin: '0 0 18px',
      }}
    >
      {facts.map((fact, index) => {
        const rating = RATING_FACT.exec(fact)
        return (
          <span key={fact}>
            {index > 0 && <span aria-hidden="true"> · </span>}
            {rating !== null && (
              <span aria-hidden="true" style={{ letterSpacing: '0.06em' }}>
                {starGlyphs(Number(rating[1]))}{' '}
              </span>
            )}
            {fact}
          </span>
        )
      })}
    </Text>
  )
}
