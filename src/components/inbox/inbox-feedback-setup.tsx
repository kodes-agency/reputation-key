// What the empty To handle queue offers beside its explanation of where private
// feedback comes from: a way to set up the page it comes from, for someone who
// may create one, and only where the scope has none (ADR 0057, amended
// 2026-10-28). It is mounted only while that empty state shows, so the question
// "does this scope have a Portal?" is asked only then.
import { Link } from '@tanstack/react-router'
import { skipToken, useQuery } from '@tanstack/react-query'
import { Button } from '#/components/ui/button'
import { portalKeys } from '#/shared/queries/query-keys'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { InboxServerFns } from './types'

type SetupTarget = Readonly<{ propertyId: string | null }>

/**
 * Where "Set up a feedback page" goes. A Portal belongs to one Property, so the
 * scope's own Property, or the only one the viewer has, is the Property whose
 * creation address opens. With several to choose from, the organization's
 * Portals page asks which one the new page is for.
 */
export function feedbackSetupTarget(
  scopePropertyId: string | undefined,
  choices: ReadonlyArray<Readonly<{ id: string }>>,
): SetupTarget {
  const only = choices.length === 1 ? choices[0]?.id : undefined
  return { propertyId: scopePropertyId ?? only ?? null }
}

type Props = Readonly<{
  /** The Property the Inbox is scoped to; undefined for all properties. */
  scopePropertyId: string | undefined
  /** The Properties the viewer can see; none when the route offers no choice. */
  propertyChoices?: ReadonlyArray<Readonly<{ id: string }>>
  getPortalPresence: InboxServerFns['getPortalPresence']
}>

const NO_CHOICES: ReadonlyArray<Readonly<{ id: string }>> = []

export function InboxFeedbackSetup({
  scopePropertyId,
  propertyChoices = NO_CHOICES,
  getPortalPresence,
}: Props) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  // A page the server would refuse to create (the organization's portal writes
  // are off) is not offered, as on the Portals pages.
  const mayCreate = can('portal.create') && has('portal.write')
  const presence = useQuery({
    queryKey: portalKeys.presence(scopePropertyId),
    queryFn:
      mayCreate && getPortalPresence
        ? () => getPortalPresence({ data: { propertyId: scopePropertyId } })
        : skipToken,
  })

  // Nothing until the answer is a plain "no portal": a scope that has one, or
  // a question that could not be answered, offers nothing it might get wrong.
  if (presence.data?.hasPortal !== false) return null

  const { propertyId } = feedbackSetupTarget(scopePropertyId, propertyChoices)
  return (
    <Button asChild variant="outline" size="sm">
      {propertyId === null ? (
        <Link to="/portals">Set up a feedback page</Link>
      ) : (
        <Link to="/properties/$propertyId/portals/new" params={{ propertyId }}>
          Set up a feedback page
        </Link>
      )}
    </Button>
  )
}
