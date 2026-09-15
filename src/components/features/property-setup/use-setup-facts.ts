import { useQueries, useQuery } from '@tanstack/react-query'
import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import { identityKeys, propertyKeys } from '#/shared/queries/query-keys'
import type {
  PropertySetupFns,
  SetupImportedProperty,
  SetupMember,
} from './property-setup-contract'
import type { SetupPropertyFacts } from './setup-plan'

export type SetupFactsState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'error'; retry: () => void }>
  | Readonly<{
      status: 'ready'
      facts: readonly SetupPropertyFacts[]
      members: ReadonlyMap<string, SetupMember>
      notice: MerchantAiNoticeDto
    }>

/**
 * Everything the setup questions depend on, read fresh: the import just
 * created these properties, so cached lists are stale by definition.
 */
export function useSetupFacts(
  properties: readonly SetupImportedProperty[],
  fns: PropertySetupFns,
): SetupFactsState {
  const list = useQuery({
    queryKey: propertyKeys.list(),
    queryFn: () => fns.listProperties(),
    staleTime: 0,
  })
  const overview = useQuery({
    queryKey: identityKeys.merchantAiOverview(),
    queryFn: () => fns.listMerchantAiOverview(),
    staleTime: 0,
  })
  const notice = useQuery({
    queryKey: identityKeys.merchantAiNotice(),
    queryFn: async () => (await fns.getMerchantAiAuthorization({ data: {} })).notice,
    staleTime: 60_000,
  })
  const members = useQuery({
    queryKey: identityKeys.members(),
    queryFn: () => fns.listMembers(),
    staleTime: 30_000,
  })
  const managers = useQueries({
    queries: properties.map((property) => ({
      queryKey: propertyKeys.responsibleManagers(property.propertyId),
      queryFn: () =>
        fns.listPropertyResponsibleManagers({
          data: { propertyId: property.propertyId },
        }),
      staleTime: 0,
    })),
  })

  const singles = [list, overview, notice, members]
  const managerStates = managers.map((read) => read.data)
  // Data outlives a failed background refetch, so once everything has loaded
  // the step stays ready; an error only matters before that.
  if (
    !list.data ||
    !overview.data ||
    !notice.data ||
    !members.data ||
    managerStates.some((state) => state === undefined)
  ) {
    if (singles.some((read) => read.isError) || managers.some((read) => read.isError)) {
      return {
        status: 'error',
        retry: () => {
          for (const read of singles) if (read.isError) void read.refetch()
          for (const read of managers) if (read.isError) void read.refetch()
        },
      }
    }
    return { status: 'loading' }
  }

  const propertyById = new Map(
    list.data.properties.map((property) => [String(property.id), property]),
  )
  const aiById = new Map(
    overview.data.properties.map((entry) => [entry.propertyId, entry]),
  )
  const facts = properties.flatMap((imported, index): SetupPropertyFacts[] => {
    const property = propertyById.get(imported.propertyId)
    const managerState = managerStates[index]
    // Removed since the import finished: nothing left to set up.
    if (!property || !managerState) return []
    const ai = aiById.get(imported.propertyId)
    return [
      {
        propertyId: imported.propertyId,
        propertyName: property.name,
        countryCode: property.countryCode ?? null,
        replyLanguage: property.defaultReplyLanguage ?? null,
        // A property outside the viewer's AI management scope is not asked.
        aiDecided: !ai || ai.state === 'enabled' || ai.decisionDeferredAt !== null,
        managerIds: managerState.assignments.map((assignment) => assignment.userId),
        eligibleManagerIds: managerState.eligibleManagers.map(
          (manager) => manager.userId,
        ),
      },
    ]
  })
  return {
    status: 'ready',
    facts,
    notice: notice.data,
    members: new Map(
      members.data.members.map((member) => [
        member.userId,
        { userId: member.userId, name: member.name, email: member.email },
      ]),
    ),
  }
}
