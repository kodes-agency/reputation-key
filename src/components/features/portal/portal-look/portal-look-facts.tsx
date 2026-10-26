// A portal's look for someone who may not change it (a Property Manager, or any
// viewer of an archived portal): what the portal takes from the property and what
// it owns, as facts, and who changes it. No control is drawn only to be disabled.
import { Link } from '@tanstack/react-router'
import { Palette } from 'lucide-react'
import type { PortalLookSources } from '#/contexts/portal/application/public-api'
import { Button } from '#/components/ui/button'
import { DescriptionItem, DescriptionList } from '#/components/ui/description-list'
import { FACTS_NOTE, lookFactsOf } from './portal-look-surface'

type Props = Readonly<{ propertyId: string; sources: PortalLookSources }>

export function PortalLookFacts({ propertyId, sources }: Props) {
  return (
    <div className="space-y-4">
      <DescriptionList aria-label="This portal’s look" termWidth="wide">
        {lookFactsOf(sources).map((fact) => (
          <DescriptionItem key={fact.term} term={fact.term}>
            {fact.value}
          </DescriptionItem>
        ))}
      </DescriptionList>
      <p className="text-sm text-muted-foreground">{FACTS_NOTE}</p>
      <Button variant="outline" asChild>
        <Link to="/properties/$propertyId/portals/look" params={{ propertyId }}>
          <Palette />
          See the property look
        </Link>
      </Button>
    </div>
  )
}
