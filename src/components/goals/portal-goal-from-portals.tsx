// "From your portals" on the Monthly portal goal's page (P-1; copy deck P-6,
// P-7): every published Portal's count of the month in the read's name order,
// never sorted and with no bars, what the rest brought in as "Other portals",
// and the total; then each established Portal that has gone quiet, with the way
// to its code. The counts are there only when they add up to the month's
// figure; the card's "See each" lands here.
import { useId } from 'react'
import { InlineLink } from '#/components/ui/inline-link'
import { SectionTitle } from '#/components/ui/section-title'
import { fromPortalsWords } from './portal-goal-page-view'
import { FROM_YOUR_PORTALS_ID } from './portal-goal-portal-counts'

/** Where the card's "See each" lands: below the sticky header. */
const ANCHOR_MARGIN = '6rem'

type Props = Readonly<{
  propertyId: string
  words: ReturnType<typeof fromPortalsWords>
}>

function Counts({
  rows,
  total,
  labelledBy,
}: Readonly<{
  rows: NonNullable<Props['words']['rows']>
  total: string | null
  labelledBy: string
}>) {
  return (
    // As wide as a name and its count read together, not the page.
    <ul aria-labelledby={labelledBy} className="flex max-w-md flex-col gap-1 text-sm">
      {rows.map((row) => (
        <li key={row.key} className="flex justify-between gap-3">
          <span className="min-w-0 truncate">{row.name}</span>
          <span className="tabular-nums">{row.count}</span>
        </li>
      ))}
      {total === null ? null : (
        <li className="flex justify-between gap-3 border-t pt-2 font-medium">
          <span>All portals</span>
          <span className="tabular-nums">{total}</span>
        </li>
      )}
    </ul>
  )
}

export function PortalGoalFromPortals({ propertyId, words }: Props) {
  const headingId = useId()
  if (words.rows === null && words.quiet.length === 0) return null
  return (
    <section
      id={FROM_YOUR_PORTALS_ID}
      aria-labelledby={headingId}
      className="flex flex-col gap-3"
      style={{ scrollMarginTop: ANCHOR_MARGIN }}
    >
      <SectionTitle id={headingId}>From your portals</SectionTitle>
      {words.rows === null ? null : (
        <Counts rows={words.rows} total={words.total} labelledBy={headingId} />
      )}
      {words.truncated === null ? null : (
        <p className="text-sm text-muted-foreground">{words.truncated}</p>
      )}
      {words.quiet.length === 0 ? null : (
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          {words.quiet.map((fact) => (
            <li key={fact.portalId}>
              {fact.text}{' '}
              {/* In a sentence: underlined, so it reads as a link in any ink. */}
              <InlineLink
                underline="always"
                to="/properties/$propertyId/portals/$portalId"
                params={{ propertyId, portalId: fact.portalId }}
                search={{ tab: 'share' }}
              >
                {fact.open}
              </InlineLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
