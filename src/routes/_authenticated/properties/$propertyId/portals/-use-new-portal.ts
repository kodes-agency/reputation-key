// The New portal dialog's data and create command, for the Portals route.
import { useNavigate, useRouteContext } from '@tanstack/react-router'
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { createPortal, getPortalCreationOptions } from '#/contexts/portal/server/portals'
import type {
  PortalNewData,
  PortalNewGroup,
  PortalNewSource,
} from '#/components/features/portal/portal-new/portal-new-types'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { portalKeys } from '#/shared/queries/query-keys'

const CREATION_OPTIONS_STALE_MS = 5_000

// What the New portal dialog reads about the Property. Only fetched once the
// dialog is open; the cached copy is refreshed on each opening, because default
// languages and eligible managers change in other places.
const portalCreationOptionsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.creationOptions(propertyId),
    queryFn: () => getPortalCreationOptions({ data: { propertyId } }),
    staleTime: CREATION_OPTIONS_STALE_MS,
  })

type NewPortalInput = Readonly<{
  propertyId: string
  propertyName: string
  /** Whether the dialog is open and the reader may create; options load only then. */
  open: boolean
  groups: readonly PortalNewGroup[]
  portals: readonly (PortalNewSource & { publicationState: string })[]
  members: PortalNewData['members'] | undefined
}>

export function useNewPortal(input: NewPortalInput) {
  const { propertyId, propertyName, open, groups, portals, members } = input
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // The signed-in person is responsible for a new portal by default.
  const { user } = useRouteContext({ from: '/_authenticated' }) as {
    user: { id: string }
  }
  const creationOptions = useQuery({
    ...portalCreationOptionsQuery(propertyId),
    enabled: open,
    retry: false,
  })
  const mutation = useActionMutation(createPortal, {
    successMessage: 'Portal created',
    invalidateKeys: [portalKeys.all],
    onSuccess: async (output) => {
      // `invalidateKeys` marks the list stale but only REFETCHES active queries,
      // and the plain portals list has no observer here. The workspace's loader
      // resolves the portal against that list, so refetch it first or it would
      // not find the portal that was just created.
      await queryClient.refetchQueries({ queryKey: portalKeys.list(propertyId) })
      // Close the dialog in place first: the entry left behind is the plain
      // list, so Back from the new workspace never reopens an empty dialog.
      await navigate({
        to: '/properties/$propertyId/portals',
        params: { propertyId },
        search: (prev) => ({ ...prev, new: undefined }),
        replace: true,
      })
      await navigate({
        to: '/properties/$propertyId/portals/$portalId',
        params: { propertyId, portalId: output.portal.id },
        search: { tab: 'page' },
      })
    },
  })
  const data: PortalNewData | null = creationOptions.data
    ? {
        propertyId,
        propertyName,
        options: creationOptions.data,
        groups: groups.map((group) => ({ id: group.id, name: group.name })),
        // An archived portal is retired; it is not offered as a starting point.
        sources: portals.filter((portal) => portal.publicationState !== 'archived'),
        members: members ?? [],
        creatorId: user.id,
        mutation,
      }
    : null
  return { data, loadError: creationOptions.error ?? undefined }
}
