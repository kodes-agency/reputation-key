// What each Portal brought in, on the Monthly portal goal's page (P-1; copy deck P-6,
// P-7): the evidence of "Where are they coming from?". Every published Portal's count
// of the month in the read's name order, never sorted and with no bars, what the rest
// brought in as "Other portals", and the total; a Portal gone quiet says so on its own
// row, with the way to its code. The counts are there only when they add up to the
// month's figure.
import { InlineLink } from '#/components/ui/inline-link'
import type { fromPortalsWords } from './portal-goal-page-view'

type Props = Readonly<{
  propertyId: string
  words: ReturnType<typeof fromPortalsWords>
}>

const ROW = 'flex justify-between gap-3 py-2'

function QuietLine({
  fact,
  propertyId,
}: Readonly<{
  fact: Props['words']['quiet'][number]
  propertyId: string
}>) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="text-warn">{fact.since}</span>
      {/* In a sentence: underlined, so it reads as a link in any ink. */}
      <InlineLink
        underline="always"
        to="/properties/$propertyId/portals/$portalId"
        params={{ propertyId, portalId: fact.portalId }}
        search={{ tab: 'share' }}
      >
        {fact.open}
      </InlineLink>
    </span>
  )
}

export function PortalGoalFromPortals({ propertyId, words }: Props) {
  const quietOf = new Map(words.quiet.map((fact) => [fact.portalId, fact]))
  const listed = new Set(words.rows?.map((row) => row.key))
  return (
    <div className="flex flex-col gap-2 py-1">
      <ul aria-label="From your portals" className="flex flex-col divide-y">
        {(words.rows ?? []).map((row) => {
          const quiet = quietOf.get(row.key)
          return (
            <li key={row.key} className={ROW}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{row.name}</span>
                {quiet === undefined ? null : (
                  <QuietLine fact={quiet} propertyId={propertyId} />
                )}
              </span>
              <span className="tabular-nums">{row.count}</span>
            </li>
          )
        })}
        {words.quiet
          .filter((fact) => !listed.has(fact.portalId))
          .map((fact) => (
            <li key={fact.portalId} className={ROW}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{fact.name}</span>
                <QuietLine fact={fact} propertyId={propertyId} />
              </span>
            </li>
          ))}
        {words.total === null ? null : (
          <li className={`${ROW} font-semibold`}>
            <span>All portals</span>
            <span className="tabular-nums">{words.total}</span>
          </li>
        )}
      </ul>
      {words.truncated === null ? null : (
        <p className="text-sm text-muted-foreground">{words.truncated}</p>
      )}
    </div>
  )
}
