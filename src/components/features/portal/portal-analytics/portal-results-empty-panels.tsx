// The panels for a Results window with no figures (portal-results-empty): the
// first-run panel, the panel of a portal that is not live yet, and the one line
// that sits above the strip of a live portal that has gone quiet.
import { BarChart3 } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button, buttonVariants } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { InlineLink } from '#/components/ui/inline-link'
import type { EmptyResults } from './portal-results-empty'
import type { PortalResultsPlace } from './portal-results-place'

function OpenAction({
  place,
  kind,
}: Readonly<{ place: PortalResultsPlace; kind: 'draft' | 'nothing' }>) {
  const params = { propertyId: place.propertyId, portalId: place.portalId }
  if (kind === 'draft') {
    return (
      <Button asChild size="sm" variant="outline">
        <Link to="/properties/$propertyId/portals/$portalId/review" params={params}>
          Review &amp; publish
        </Link>
      </Button>
    )
  }
  return (
    <Button asChild size="sm" variant="outline">
      <Link
        to="/properties/$propertyId/portals/$portalId"
        params={params}
        search={{ tab: 'share' }}
      >
        See the code
      </Link>
    </Button>
  )
}

/** The panel in place of the figures; `kind: 'quiet'` is not one (see QuietWindowNote). */
export function EmptyResultsPanel({
  empty,
  place,
}: Readonly<{
  empty: Exclude<EmptyResults, Readonly<{ kind: 'quiet' }>>
  place?: PortalResultsPlace
}>) {
  const action = place ? <OpenAction place={place} kind={empty.kind} /> : undefined
  if (empty.kind === 'draft') {
    return (
      <EmptyState
        icon={BarChart3}
        title="No results yet"
        description="Results start once this portal is published and its code is shared."
        action={action}
      />
    )
  }
  return (
    <EmptyState
      icon={BarChart3}
      title={empty.title}
      description={empty.description}
      action={action}
    />
  )
}

/** One sentence above the strip: the zeros are the news, so the strip stays. */
export function QuietWindowNote({
  line,
  place,
}: Readonly<{ line: string; place?: PortalResultsPlace }>) {
  return (
    <Alert variant="info">
      <AlertDescription>
        {line}
        {place ? (
          <>
            {' '}
            <InlineLink
              to="/properties/$propertyId/portals/$portalId"
              params={{ propertyId: place.propertyId, portalId: place.portalId }}
              search={{ tab: 'share' }}
              underline="always"
              // A tap target on a phone; the sentence's own line on a desktop.
              className={buttonVariants({ variant: 'link', size: 'inline', touch: true })}
            >
              See the code
            </InlineLink>
          </>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
