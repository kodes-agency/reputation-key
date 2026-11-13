import { useTenantScope } from '#/shared/hooks/useTenantScope'
import { useQueries, useQuery } from '@tanstack/react-query'
import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import {
  portalKeys,
  propertyKeys,
  reviewKeys,
  createKeys,
} from '#/shared/queries/query-keys'
import type {
  PropertySetupFns,
  SetupImportedProperty,
  SetupMember,
} from './property-setup-contract'
import type { SetupPropertyFacts } from './setup-plan'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'

export type SetupFactsState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'error'; retry: () => void; retrying: boolean }>
  | Readonly<{
      status: 'ready'
      facts: readonly SetupPropertyFacts[]
      members: ReadonlyMap<string, SetupMember>
      notice: MerchantAiNoticeDto
    }>

/** One fresh read per imported property; the import just created them. */
function usePerProperty<TData>(
  properties: readonly SetupImportedProperty[],
  read: (propertyId: string) => Readonly<{
    queryKey: readonly unknown[]
    queryFn: () => Promise<TData>
  }>,
) {
  return useQueries({
    queries: properties.map((property) => ({
      ...read(property.propertyId),
      staleTime: 0,
    })),
  })
}

type SetupRead = Readonly<{
  data: unknown
  isError: boolean
  isFetching: boolean
  errorUpdateCount: number
  refetch: () => unknown
}>

/**
 * Loading until every read has data. Data outlives a failed background
 * refetch, so once everything has loaded the step stays ready; an error only
 * matters before that, and its retry reads only what failed.
 */
export function settleSetupReads(
  reads: readonly SetupRead[],
):
  | Readonly<{ status: 'loading' }>
  | Extract<SetupFactsState, { status: 'error' }>
  | Readonly<{ status: 'ready' }> {
  if (reads.every((read) => read.data !== undefined)) return { status: 'ready' }
  if (!reads.some((read) => hasFailed(read))) return { status: 'loading' }
  return {
    status: 'error',
    retry: () => {
      for (const read of reads) if (read.isError) void read.refetch()
    },
    retrying: isRetrying(reads),
  }
}

/**
 * Everything the setup questions depend on, read fresh: the import just
 * created these properties, so cached lists are stale by definition.
 */
export function useSetupFacts(
  properties: readonly SetupImportedProperty[],
  fns: PropertySetupFns,
): SetupFactsState {
  const { identityKeys } = createKeys(useTenantScope())
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
  const managers = usePerProperty(properties, (propertyId) => ({
    queryKey: propertyKeys.responsibleManagers(propertyId),
    queryFn: () => fns.listPropertyResponsibleManagers({ data: { propertyId } }),
  }))
  const experiences = usePerProperty(properties, (propertyId) => ({
    queryKey: portalKeys.propertyExperience(propertyId),
    queryFn: () => fns.getPropertyPortalExperience({ data: { propertyId } }),
  }))
  const setups = usePerProperty(properties, (propertyId) => ({
    queryKey: propertyKeys.setup(propertyId),
    queryFn: () => fns.getPropertySetup({ data: { propertyId } }),
  }))
  const replyLibraries = usePerProperty(properties, (propertyId) => ({
    queryKey: reviewKeys.replyLibrary(propertyId),
    queryFn: () => fns.getReplyLibrary({ data: { propertyId } }),
  }))

  const settled = settleSetupReads([
    list,
    overview,
    notice,
    members,
    ...managers,
    ...experiences,
    ...setups,
    ...replyLibraries,
  ])
  if (settled.status !== 'ready') return settled
  // Ready means every read has data; this narrows the single reads for the types.
  if (!list.data || !overview.data || !notice.data || !members.data) {
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
    const managerState = managers[index]?.data
    const experience = experiences[index]?.data
    const setup = setups[index]?.data
    const replyLibrary = replyLibraries[index]?.data
    // Removed since the import finished: nothing left to set up.
    if (!property || !managerState || !experience || !setup || !replyLibrary) return []
    const ai = aiById.get(imported.propertyId)
    return [
      {
        propertyId: imported.propertyId,
        propertyName: property.name,
        publicDisplayName: experience.profile?.displayName ?? null,
        publicDisplayNameConfirmed: experience.publicDisplayNameConfirmed,
        countryCode: property.countryCode ?? null,
        replyLanguage: property.defaultReplyLanguage ?? null,
        // A property outside the viewer's AI management scope is not asked.
        aiDecided: !ai || ai.state === 'enabled' || ai.decisionDeferredAt !== null,
        managerIds: managerState.assignments.map((assignment) => assignment.userId),
        eligibleManagerIds: managerState.eligibleManagers.map(
          (manager) => manager.userId,
        ),
        replyVoiceConfigured: setup.steps.some(
          (step) => step.key === 'reply_voice' && step.status === 'complete',
        ),
        replyVoice: replyLibrary.voice,
        replyVoiceVersion: replyLibrary.voiceVersion,
        propertyCount: list.data.properties.length,
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
