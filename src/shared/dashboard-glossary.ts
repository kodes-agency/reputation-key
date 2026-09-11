// The eight dashboard terms that need a definition, defined once
// (redesign row 11).
//
// The survey found the read model's vocabulary rendered straight to merchants:
// "Weighted impact +4.40" with its meaning in an 11 px footnote citing
// `aspect-impact-v1`, "eligible ratings", "star-only", "analysed before aspect
// analysis existed". Renaming fixes most of it; these eight are genuinely new
// ideas that a manager cannot infer from the words alone, so each gets one
// definition, in one place, shown on first use per page.
//
// The bar for entry: a manager could reasonably ask "what counts as this?" and
// get it wrong. Everything else is renamed until it explains itself.

export type GlossaryTermKey =
  | 'impact'
  | 'praise-and-complaints'
  | 'topics'
  | 'emerging-issues'
  | 'needs-attention'
  | 'reply-rate'
  | 'profile-views'
  | 'updated'

export type GlossaryEntry = Readonly<{
  /** The word as it appears in the interface. */
  term: string
  /** One sentence, no jargon, no version identifiers. */
  definition: string
}>

export const DASHBOARD_GLOSSARY: Readonly<Record<GlossaryTermKey, GlossaryEntry>> = {
  impact: {
    term: 'Impact',
    definition:
      'How strongly a topic pulls your rating up or down, from how often guests mention it and how strongly they feel. Above zero helps your rating; below zero hurts it.',
  },
  'praise-and-complaints': {
    term: 'Praise and complaints',
    definition:
      'Each mention of a topic in a review is counted as praise or a complaint, based on how the guest wrote about it. One review can mention several topics.',
  },
  topics: {
    term: 'Topics',
    definition:
      'What a review is about — rooms, staff, cleanliness, parking and so on. Found by reading the review text, so reviews without text have no topics.',
  },
  'emerging-issues': {
    term: 'Emerging issues',
    definition:
      'Specific problems named in more than one review, like "air conditioning failure". Narrower than a topic, and usually newer.',
  },
  'needs-attention': {
    term: 'Needs attention',
    definition:
      'Work waiting on you: reviews to triage, replies past their due time, escalated items, a rating that dropped, and goals behind pace.',
  },
  'reply-rate': {
    term: 'Reply rate',
    definition:
      'The share of reviews in this period that have a published reply. Drafts do not count until they are published.',
  },
  'profile-views': {
    term: 'Profile views',
    definition:
      'How many times your Google Business Profile was seen on Search and Maps. Reported by Google, not measured by RepKey.',
  },
  updated: {
    term: 'Updated',
    definition:
      'When RepKey last read this data. Google reports its own figures with a delay of a day or two, which is shown separately.',
  },
}
