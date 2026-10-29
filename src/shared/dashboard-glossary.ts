// The dashboard terms that need a definition, defined once
// (redesign row 11).
//
// The survey found the read model's vocabulary rendered straight to merchants:
// "Weighted impact +4.40" with its meaning in an 11 px footnote citing
// `aspect-impact-v1`, "eligible ratings", "star-only", "analysed before aspect
// analysis existed". Renaming fixes most of it; these are genuinely new
// ideas that a manager cannot infer from the words alone, so each gets one
// definition, in one place, shown on first use per page.
//
// The bar for entry: a manager could reasonably ask "what counts as this?" and
// get it wrong. Everything else is renamed until it explains itself.

export type GlossaryTermKey =
  | 'praise-and-complaints'
  | 'stars-when-mentioned'
  | 'likely-change'
  | 'topics'
  | 'recurring-issues'
  | 'needs-attention'
  | 'reply-rate'
  | 'reply-time'
  | 'profile-views'
  | 'updated'
  | 'qualified-scans'

export type GlossaryEntry = Readonly<{
  /** The word as it appears in the interface. */
  term: string
  /** One sentence, no jargon, no version identifiers. */
  definition: string
}>

export const DASHBOARD_GLOSSARY: Readonly<Record<GlossaryTermKey, GlossaryEntry>> = {
  'praise-and-complaints': {
    term: 'Praise and complaints',
    definition:
      'A review counts as praise for a topic when the guest writes well of it, and as a complaint when they write badly of it. One review can name several topics, and can both praise and criticise one.',
  },
  // "Association, not proof": guests who complain tend to rate lower, which this
  // shows; it cannot show that the topic is why they rated lower.
  'stars-when-mentioned': {
    term: 'Stars when mentioned',
    definition:
      'The average stars of the reviews that complain about a topic, next to the average of every other review in this period. It shows that they go together, not that the topic caused the lower rating.',
  },
  // The comparison is the Property's own previous 12 months, and what it claims is
  // that the share moved more than its usual ups and downs over that year. It states
  // no odds: a stated chance promised more than the test measures.
  'likely-change': {
    term: 'Change',
    definition:
      'Shown when the share of reviews that name a topic has moved by more than its usual ups and downs over the past year. It is compared with the 12 months before this period, and only once those months hold at least 20 analysed reviews. Most topics show nothing.',
  },
  topics: {
    term: 'Topics',
    definition:
      'What a review is about — rooms, staff, cleanliness, parking and so on. Found by reading the review text, so reviews without text have no topics.',
  },
  'recurring-issues': {
    term: 'Recurring issues',
    definition:
      'Specific problems named in two or more reviews in this period, like "air conditioning failure". Narrower than a topic. A problem one guest names once is not counted.',
  },
  'needs-attention': {
    term: 'Needs attention',
    definition:
      'Work waiting on you: reviews to triage, replies past their due time, escalated items, a rating that dropped, and portal goals below pace.',
  },
  // A reply written directly on Google counts as much as one sent from RepKey
  // (owner decision, 2026-10-17): Google shows the guest both.
  'reply-rate': {
    term: 'Reply rate',
    definition:
      'The share of reviews in this period that have a reply on Google, whether it was sent from RepKey or written directly on Google. Each review counts once, and drafts do not count until they are published.',
  },
  // Google reports only when a reply was last edited, not when it was first
  // posted, so that is the time a reply written on Google is measured by.
  // RepKey's own reply time moves too when an edit sent from RepKey reaches
  // Google, so the caveat covers any edited reply, not only Google's.
  'reply-time': {
    term: 'Average reply time',
    definition:
      'How long reviews in this period waited for a reply, on average. Replies written directly on Google count too. If a reply was edited later, the time can run to the edit rather than the first reply, so it can look slower.',
  },
  'profile-views': {
    term: 'Profile views',
    definition:
      'How many times your Google Business Profile was seen on Search and Maps. Reported by Google, not measured by RepKey.',
  },
  'qualified-scans': {
    term: 'Qualified scans',
    definition:
      'Visits to a portal that our server verified, counted once per guest in 24 hours. Page opens from bots and refreshes are not counted, so this is lower than a raw count of opens.',
  },
  updated: {
    term: 'Updated',
    definition:
      'When RepKey last read this data. Google reports its own figures with a delay of a day or two, which is shown separately.',
  },
}
